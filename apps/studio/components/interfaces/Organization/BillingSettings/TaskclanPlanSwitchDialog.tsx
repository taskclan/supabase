/**
 * Confirming a switch between paid plans.
 *
 * The engine moves the existing subscription to the new plan in place and
 * settles the difference at once, so this dialog's job is to show that amount
 * before anything is charged. It asks the engine for Stripe's own proration
 * (preview_switch), and the confirm sends the preview's proration date back, so
 * the card is charged the amount shown here to the cent. Account credit, such as
 * the credit from an earlier downgrade, is spent before the card.
 */
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogSectionSeparator,
  DialogTitle,
} from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import { formatUsd } from '@/lib/taskclan/usage'

/** Mirrors the engine's PlanSwitchPreview (billing/planSwitch). */
export interface PlanSwitchPreview {
  plan: string
  currentPlan: string | null
  direction: 'upgrade' | 'downgrade' | 'same'
  currentMonthlyUsd: number | null
  newMonthlyUsd: number
  /** > 0 is charged now, < 0 is credited to the next invoice. */
  dueNowUsd: number
  /** How much of a positive dueNowUsd existing account credit covers. */
  accountCreditUsd: number
  renewsAt: string | null
  resumes: boolean
  prorationDate: number
}

export interface SwitchTarget {
  id: string
  name: string
  maxSize: string
  autoscaleMax: number
  includedUsd: number
}

interface Props {
  /** The plan being switched to; null keeps the dialog closed. */
  plan: SwitchTarget | null
  currentName: string
  onClose: () => void
  /** The current plan has no Stripe subscription behind it: subscribe through Checkout instead. */
  onNeedsCheckout: (planId: string) => void
}

const post = (body: Record<string, unknown>) =>
  taskclanFetch('/api/taskclan/billing/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const Row = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="flex items-baseline justify-between gap-4">
    <div>
      <p className="text-foreground">{label}</p>
      {hint && <p className="text-xs text-foreground-lighter">{hint}</p>}
    </div>
    <p className="shrink-0 tabular-nums text-foreground">{value}</p>
  </div>
)

export const TaskclanPlanSwitchDialog = ({
  plan,
  currentName,
  onClose,
  onNeedsCheckout,
}: Props) => {
  const [preview, setPreview] = useState<PlanSwitchPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!plan) return
    let live = true
    setPreview(null)
    setError(null)
    ;(async () => {
      try {
        const res = await post({ action: 'preview_switch', plan: plan.id })
        const data = await res.json()
        if (!live) return
        if (res.ok && data?.preview) setPreview(data.preview as PlanSwitchPreview)
        else if (data?.code === 'no_subscription') onNeedsCheckout(plan.id)
        else setError(data?.error ?? 'Could not price this change')
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not reach Taskclan Cloud')
      }
    })()
    return () => {
      live = false
    }
  }, [plan, onNeedsCheckout])

  const confirm = async () => {
    if (!plan || !preview) return
    setConfirming(true)
    setError(null)
    try {
      const res = await post({
        action: 'upgrade',
        plan: plan.id,
        confirm: true,
        prorationDate: preview.prorationDate,
      })
      const data = await res.json()
      if (res.ok && data?.ok) {
        toast.success(`You're on ${plan.name} now`)
        window.location.reload()
        return
      }
      setError(data?.error ?? 'Could not change your plan')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change your plan')
    } finally {
      setConfirming(false)
    }
  }

  const renews = preview?.renewsAt ? dayjs(preview.renewsAt).format('MMM D, YYYY') : null
  const cardCharge = preview ? Math.max(preview.dueNowUsd - preview.accountCreditUsd, 0) : 0
  const confirmLabel =
    preview?.direction === 'upgrade' && cardCharge > 0
      ? `Pay ${formatUsd(cardCharge)} and switch`
      : preview?.direction === 'same'
        ? `Keep ${plan?.name ?? 'my plan'}`
        : `Switch to ${plan?.name ?? 'this plan'}`

  return (
    <Dialog
      open={plan !== null}
      onOpenChange={(open) => {
        if (!open && !confirming) onClose()
      }}
    >
      <DialogContent size="small">
        <DialogHeader>
          <DialogTitle>Switch to {plan?.name}</DialogTitle>
          <DialogDescription>Your plan changes as soon as you confirm.</DialogDescription>
        </DialogHeader>
        <DialogSectionSeparator />
        <DialogSection className="flex flex-col gap-3 text-sm">
          {!preview && !error && <p className="text-foreground-light">Working out the price…</p>}

          {preview?.direction === 'upgrade' && (
            <>
              <Row
                label="Due now"
                value={formatUsd(preview.dueNowUsd)}
                hint={`${plan?.name} for the rest of this billing period, less your unused ${currentName}`}
              />
              {preview.accountCreditUsd > 0 && (
                <>
                  <Row
                    label="Paid from your account credit"
                    value={formatUsd(preview.accountCreditUsd)}
                  />
                  <Row label="Charged to your card" value={formatUsd(cardCharge)} />
                </>
              )}
            </>
          )}

          {preview?.direction === 'downgrade' && (
            <Row
              label={`Credit for unused ${currentName}`}
              value={formatUsd(Math.abs(preview.dueNowUsd))}
              hint="Nothing is charged now. The credit comes off your next invoice."
            />
          )}

          {preview?.direction === 'same' && (
            <p className="text-foreground-light">
              {preview.resumes
                ? `You're on ${plan?.name} and it's set to cancel${renews ? ` on ${renews}` : ''}. Confirm to keep it.`
                : `You're already on ${plan?.name}.`}
            </p>
          )}

          {preview && (
            <Row
              label="Then"
              value={`${formatUsd(preview.newMonthlyUsd)}/mo`}
              hint={renews ? `From ${renews}, every month` : undefined}
            />
          )}

          {plan && preview && preview.direction !== 'same' && (
            <p className="text-xs text-foreground-lighter">
              {plan.name} runs apps up to {plan.maxSize}
              {plan.autoscaleMax > 0
                ? `, autoscales to ${plan.autoscaleMax} instances`
                : ', one instance each'}
              {plan.includedUsd > 0
                ? `, and includes ${formatUsd(plan.includedUsd)} of usage a month.`
                : '.'}
            </p>
          )}

          {error && (
            <Admonition type="warning" title="Your plan wasn't changed">
              {error}
            </Admonition>
          )}
        </DialogSection>
        <DialogFooter>
          <Button variant="default" disabled={confirming} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={confirming}
            disabled={!preview || confirming || (preview.direction === 'same' && !preview.resumes)}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
