/**
 * Add a card on file for Taskclan Cloud (pay-as-you-go / postpaid).
 *
 * Stripe Elements collects the card in the browser against a SetupIntent minted
 * by the engine — card data never reaches this console. On submit we confirm the
 * SetupIntent, then hand the resulting payment-method id to the engine's
 * `confirm` action, which runs a $1 verification hold, sets it as default, and
 * enrolls the org in postpaid billing.
 */
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from 'ui'

import { getStripeElementsAppearanceOptions } from '@/components/interfaces/Billing/Payment/Payment.utils'
import { STRIPE_PUBLIC_KEY } from '@/lib/constants'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

const stripePromise = loadStripe(STRIPE_PUBLIC_KEY)

const CardForm = ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) => {
  const stripe = useStripe()
  const elements = useElements()
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!stripe || !elements) return
    setSaving(true)
    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: window.location.href },
      })
      if (error) {
        toast.error(error.message ?? 'Could not save the card')
        return
      }
      const pm = setupIntent?.payment_method
      const paymentMethodId = typeof pm === 'string' ? pm : (pm?.id ?? '')
      if (!paymentMethodId) {
        toast.error('The card was not saved. Please try again.')
        return
      }
      const res = await taskclanFetch('/api/taskclan/billing/payment-methods', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', paymentMethodId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? 'Could not verify the card')
        return
      }
      toast.success("Card added — you're on pay-as-you-go billing.")
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the card')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <p className="text-xs text-foreground-light">
        We&apos;ll place a temporary $1 hold to check the card works — it&apos;s released right away
        and never charged. You&apos;ll then be billed monthly for what you use.
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" loading={saving} disabled={!stripe || saving} onClick={submit}>
          Add card
        </Button>
      </div>
    </div>
  )
}

export const TaskclanAddCardModal = ({
  visible,
  onCancel,
  onDone,
}: {
  visible: boolean
  onCancel: () => void
  onDone: () => void
}) => {
  const { resolvedTheme } = useTheme()
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) {
      setClientSecret(null)
      setError(null)
      return
    }
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch('/api/taskclan/billing/payment-methods', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'setup_intent' }),
        })
        const body = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok || !body?.clientSecret) setError(body?.error ?? 'Could not start card setup')
        else setClientSecret(body.clientSecret as string)
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not start card setup')
      }
    })()
    return () => {
      live = false
    }
  }, [visible])

  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent size="medium">
        <DialogHeader>
          <DialogTitle>Add a payment method</DialogTitle>
        </DialogHeader>
        <div className="p-4">
          {error ? (
            <p className="text-sm text-destructive-600">{error}</p>
          ) : !clientSecret ? (
            <p className="text-sm text-foreground-light">Loading secure card form…</p>
          ) : (
            <Elements
              stripe={stripePromise}
              options={{ clientSecret, appearance: getStripeElementsAppearanceOptions(resolvedTheme) }}
            >
              <CardForm onDone={onDone} onCancel={onCancel} />
            </Elements>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
