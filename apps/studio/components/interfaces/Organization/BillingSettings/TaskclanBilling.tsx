/**
 * Billing, as Taskclan Cloud actually does it.
 *
 * Upstream's page is built for a subscription: a plan with an included quota, a
 * spend cap for scaling past it, an upcoming invoice that accrues through a
 * billing cycle, and a history of invoices issued when the cycle resets. Cloud
 * has none of that. It sells prepaid credits, meters usage against the balance
 * by the second, and stops when the balance runs out.
 *
 * So the page showed four copies of "Failed to retrieve subscription" and a
 * billing cycle of January 01 to January 01, which is what an epoch timestamp
 * looks like when it is formatted as a date.
 *
 * It answers the questions this billing model actually has: how much credit is
 * left and how to add more (prepaid), plus — for orgs that add a card — a
 * payment method on file and a history of the monthly invoices raised against
 * it (postpaid pay-as-you-go). Adding a card is what moves an org onto postpaid.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, CardContent } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import { GenericSkeletonLoader } from 'ui-patterns/ShimmeringLoader'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import { formatCredits, formatUsd } from '@/lib/taskclan/usage'
import { TaskclanPaymentMethods } from './TaskclanPaymentMethods'
import { TaskclanInvoices } from './TaskclanInvoices'

interface Pack {
  id: string
  label: string
  priceUsd: number
  credits: number
  bonusPct: number
}

interface CreditsResponse {
  plan?: string
  balanceCredits?: number
  balanceUsd?: number
  usage?: { periodDays?: number; totalUsd?: number }
  packs?: Pack[]
}

export const TaskclanBilling = () => {
  const [data, setData] = useState<CreditsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buying, setBuying] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch('/api/taskclan/credits')
        const body = await res.json()
        if (!live) return
        if (!res.ok) setError(body?.error ?? `Taskclan Cloud answered ${res.status}`)
        else setData(body as CreditsResponse)
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not reach Taskclan Cloud')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const topUp = async (packId: string) => {
    setBuying(packId)
    try {
      const res = await taskclanFetch('/api/taskclan/credits/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      const body = await res.json()
      if (!res.ok || !body?.url) {
        toast.error(body?.error ?? 'Could not start checkout')
        return
      }
      // Stripe's hosted page. Card details never reach this console.
      window.location.href = body.url as string
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start checkout')
    } finally {
      setBuying(null)
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <Admonition type="warning" title="Could not load billing">
          {error}
        </Admonition>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6">
        <GenericSkeletonLoader />
      </div>
    )
  }

  const balanceUsd = data.balanceUsd ?? 0
  const spentUsd = data.usage?.totalUsd ?? 0
  const periodDays = data.usage?.periodDays ?? 30
  // Only a guide, and described as one: it assumes the next period looks like
  // the last, which is exactly what it will not do if somebody deploys
  // something. Better than no signal, worse than a promise.
  const daysLeft = spentUsd > 0 ? Math.floor((balanceUsd / spentUsd) * periodDays) : null

  return (
    <div className="flex flex-col gap-8 p-6">
      <section>
        <h3 className="mb-1 text-foreground">Credit balance</h3>
        <p className="mb-4 text-sm text-foreground-light">
          Taskclan Cloud is prepaid. Usage is metered by the second against this balance, and apps
          cost nothing while they are asleep.
        </p>
        <Card>
          <CardContent className="flex flex-wrap items-end justify-between gap-6 py-5">
            <div>
              <p className="text-3xl text-foreground">{formatUsd(balanceUsd)}</p>
              <p className="text-sm text-foreground-light">
                {formatCredits(data.balanceCredits ?? 0)} credits
                {data.plan
                  ? ` · ${data.plan.charAt(0).toUpperCase()}${data.plan.slice(1)} plan`
                  : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-foreground-light">
                {formatUsd(spentUsd)} used in the last {periodDays} days
              </p>
              {daysLeft !== null && (
                <p className="text-sm text-foreground-lighter">
                  About {daysLeft} days left at that rate
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <TaskclanPaymentMethods />

      <section>
        <h3 className="mb-1 text-foreground">Add credits</h3>
        <p className="mb-4 text-sm text-foreground-light">
          Payment is handled by Stripe. Card details never reach this console, and Stripe emails a
          receipt for each purchase.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {(data.packs ?? []).map((pack) => (
            <Card key={pack.id}>
              <CardContent className="flex flex-col gap-3 py-5">
                <div>
                  <p className="text-foreground">{pack.label}</p>
                  <p className="text-2xl text-foreground">{formatUsd(pack.priceUsd)}</p>
                  <p className="text-sm text-foreground-light">
                    {formatCredits(pack.credits)} credits
                    {pack.bonusPct > 0 ? ` · ${pack.bonusPct}% extra` : ''}
                  </p>
                </div>
                <Button
                  block
                  loading={buying === pack.id}
                  disabled={buying !== null}
                  onClick={() => topUp(pack.id)}
                >
                  Buy
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <TaskclanInvoices />
    </div>
  )
}
