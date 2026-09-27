/**
 * Plan tiers — the primary billing surface.
 *
 * Taskclan Cloud is plans-first: an org picks a tier (Free / Starter / Pro /
 * Scale / Enterprise) that sets its capability ceiling — container sizes,
 * autoscaling, and a monthly amount of included usage — and pays for anything
 * beyond that as metered usage (credits or pay-as-you-go, shown below).
 *
 * The catalog is fetched from the engine so the numbers here can never drift
 * from what the platform actually charges and enforces. First-time subscribers
 * go to Stripe Checkout (subscription mode). A subscriber moving between paid
 * plans confirms the exact prorated amount in TaskclanPlanSwitchDialog and the
 * engine switches the subscription in place; cancelling, changing the card and
 * reading invoices happen in Stripe's billing portal. Card details never reach
 * this console.
 */
import { Check } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, CardContent } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import { TaskclanPlanSwitchDialog } from './TaskclanPlanSwitchDialog'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import { formatUsd } from '@/lib/taskclan/usage'

/** Mirrors the engine's PlanCard from /api/cloud/v1/plans (billing/planCatalog). */
interface PlanCard {
  id: string
  name: string
  /** Monthly price in USD; null = custom (contact sales). */
  monthlyUsd: number | null
  /** Usage (USD) included in the monthly fee, or the one-time free grant. */
  includedUsd: number
  blurb: string
  /** Largest instance size this plan can run (display label). */
  maxSize: string
  /** Autoscaling ceiling; 0 = no autoscaling. */
  autoscaleMax: number
  storageDays: number | null
}

const ORDER = ['free', 'starter', 'pro', 'scale', 'enterprise']
const rank = (plan: string | undefined) => {
  const i = ORDER.indexOf((plan ?? 'free').toLowerCase())
  return i < 0 ? 0 : i
}
const SALES_EMAIL = 'sales@taskclan.com'

export const TaskclanPlans = ({ currentPlan }: { currentPlan?: string }) => {
  const [plans, setPlans] = useState<PlanCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  /** The paid plan a subscriber is switching to; opens the confirm dialog. */
  const [switchTo, setSwitchTo] = useState<PlanCard | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch('/api/taskclan/plans')
        const body = await res.json()
        if (!live) return
        if (!res.ok) setError(body?.error ?? `Taskclan Cloud answered ${res.status}`)
        else setPlans((body?.plans as PlanCard[]) ?? [])
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not reach Taskclan Cloud')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  // Subscribe, go to Free, or open the portal: one call, and the engine decides
  // whether this org goes to Checkout (no subscription yet) or the billing
  // portal (has one); we follow whichever URL comes back. Switching between
  // paid plans goes through the confirm dialog instead.
  const act = useCallback(async (body: Record<string, unknown>, key: string) => {
    setActing(key)
    try {
      const res = await taskclanFetch('/api/taskclan/billing/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error ?? 'Could not update your plan')
        return
      }
      if (data?.contactSales) {
        window.location.href = `mailto:${SALES_EMAIL}?subject=Taskclan%20Cloud%20Enterprise`
        return
      }
      const url = (data?.checkoutUrl ?? data?.portalUrl) as string | undefined
      if (url) {
        window.location.href = url // Stripe's hosted Checkout / billing portal.
        return
      }
      if (data?.ok) {
        toast.success('Your plan has been updated')
        window.location.reload()
        return
      }
      toast.error('Could not update your plan')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update your plan')
    } finally {
      setActing(null)
    }
  }, [])

  // A paid plan with no Stripe subscription behind it (set by hand) has nothing
  // to switch, so the dialog hands back and this subscribes through Checkout.
  const subscribeInstead = useCallback(
    (planId: string) => {
      setSwitchTo(null)
      void act({ action: 'upgrade', plan: planId }, planId)
    },
    [act]
  )

  if (error) {
    return (
      <section>
        <h3 className="mb-1 text-foreground">Plan</h3>
        <Admonition type="warning" title="Could not load plans">
          {error}
        </Admonition>
      </section>
    )
  }

  const current = (currentPlan ?? 'free').toLowerCase()
  const isSubscribed = rank(current) > 0 && current !== 'enterprise'
  const cards = plans ?? []

  const choosePlan = (plan: PlanCard) => {
    if (plan.monthlyUsd == null) {
      window.location.href = `mailto:${SALES_EMAIL}?subject=Taskclan%20Cloud%20Enterprise`
      return
    }
    // Paid to paid: confirm the prorated amount, then switch in place.
    if (isSubscribed && plan.monthlyUsd > 0) {
      setSwitchTo(plan)
      return
    }
    void act({ action: 'upgrade', plan: plan.id }, plan.id)
  }

  const priceLabel = (p: PlanCard) =>
    p.monthlyUsd == null ? 'Custom' : p.monthlyUsd === 0 ? 'Free' : formatUsd(p.monthlyUsd)

  const ctaLabel = (p: PlanCard, isCurrent: boolean) => {
    if (isCurrent) return 'Current plan'
    if (p.monthlyUsd == null) return 'Contact sales'
    if (rank(current) === 0) return 'Subscribe'
    return rank(p.id) > rank(current) ? 'Upgrade' : 'Downgrade'
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="mb-1 text-foreground">Plan</h3>
          <p className="text-sm text-foreground-light">
            Your plan sets your app sizes, autoscaling, and monthly included usage. Usage beyond that
            is billed as metered credits or pay-as-you-go below.
          </p>
        </div>
        {isSubscribed && (
          <Button
            variant="default"
            loading={acting === 'portal'}
            disabled={acting !== null}
            onClick={() => void act({ action: 'portal' }, 'portal')}
          >
            Manage subscription
          </Button>
        )}
      </div>

      {plans === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="h-52 animate-pulse py-5" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards
            .filter((p) => p.monthlyUsd != null)
            .map((p) => {
              const isCurrent = p.id.toLowerCase() === current
              return (
                <Card
                  key={p.id}
                  className={isCurrent ? 'border-brand-500 ring-1 ring-brand-500' : undefined}
                >
                  <CardContent className="flex h-full flex-col gap-4 py-5">
                    <div className="flex items-center justify-between">
                      <p className="text-foreground">{p.name}</p>
                      {isCurrent && <Badge variant="success">Current</Badge>}
                    </div>
                    <div>
                      <p className="text-2xl text-foreground">
                        {priceLabel(p)}
                        {p.monthlyUsd && p.monthlyUsd > 0 ? (
                          <span className="text-sm text-foreground-light"> /mo</span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-sm text-foreground-light">{p.blurb}</p>
                    </div>
                    <ul className="flex flex-col gap-1.5 text-sm text-foreground-light">
                      <li className="flex items-start gap-2">
                        <Check size={14} className="mt-0.5 shrink-0 text-brand" />
                        {p.includedUsd > 0
                          ? `${formatUsd(p.includedUsd)}${p.monthlyUsd ? '/mo' : ''} usage included`
                          : 'Usage billed as you go'}
                      </li>
                      <li className="flex items-start gap-2">
                        <Check size={14} className="mt-0.5 shrink-0 text-brand" />
                        Up to {p.maxSize}
                      </li>
                      <li className="flex items-start gap-2">
                        <Check size={14} className="mt-0.5 shrink-0 text-brand" />
                        {p.autoscaleMax > 0 ? `Autoscale to ${p.autoscaleMax} instances` : 'Single instance'}
                      </li>
                    </ul>
                    <div className="mt-auto">
                      <Button
                        block
                        variant={isCurrent ? 'default' : rank(p.id) >= rank(current) ? 'primary' : 'default'}
                        disabled={isCurrent || acting !== null}
                        loading={acting === p.id}
                        onClick={() => choosePlan(p)}
                      >
                        {ctaLabel(p, isCurrent)}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
        </div>
      )}

      {/* Enterprise sits apart — it is sales-assisted, not a self-serve checkout. */}
      {cards.some((p) => p.monthlyUsd == null) &&
        (() => {
          const ent = cards.find((p) => p.monthlyUsd == null)!
          const isCurrent = ent.id.toLowerCase() === current
          return (
            <Card className="mt-4">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-foreground">{ent.name}</p>
                    {isCurrent && <Badge variant="success">Current</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-foreground-light">{ent.blurb}</p>
                </div>
                <Button variant="default" onClick={() => choosePlan(ent)}>
                  Contact sales
                </Button>
              </CardContent>
            </Card>
          )
        })()}

      <TaskclanPlanSwitchDialog
        plan={switchTo}
        currentName={cards.find((p) => p.id.toLowerCase() === current)?.name ?? 'plan'}
        onClose={() => setSwitchTo(null)}
        onNeedsCheckout={subscribeInstead}
      />
    </section>
  )
}
