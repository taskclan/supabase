/**
 * The org's cards on file. Adding a card (embedded Stripe Elements) puts the
 * org on pay-as-you-go billing; the postpaid cycle then charges the default card
 * monthly. Owner-only on the engine side.
 */
import { CreditCard, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from 'ui'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import { TaskclanAddCardModal } from './TaskclanAddCardModal'

interface CardOnFile {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}

export const TaskclanPaymentMethods = () => {
  const [cards, setCards] = useState<CardOnFile[] | null>(null)
  const [billingMode, setBillingMode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await taskclanFetch('/api/taskclan/billing/payment-methods')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error ?? `Could not load cards (${res.status})`)
        return
      }
      setCards(Array.isArray(body?.cards) ? (body.cards as CardOnFile[]) : [])
      setBillingMode(body?.billingMode ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load cards')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const act = async (action: 'set_default' | 'remove', id: string, failMsg: string) => {
    setBusy(id)
    try {
      const res = await taskclanFetch('/api/taskclan/billing/payment-methods', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, paymentMethodId: id }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        toast.error(b?.error ?? failMsg)
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base text-foreground">Payment method</h3>
          <p className="text-sm text-foreground-light">
            {billingMode === 'postpaid'
              ? 'Pay-as-you-go — your default card is charged monthly for what you use.'
              : 'Add a card to deploy on pay-as-you-go billing (charged monthly for usage).'}
          </p>
        </div>
        <Button type="button" icon={<CreditCard />} onClick={() => setShowAdd(true)}>
          {cards && cards.length > 0 ? 'Add card' : 'Add a card'}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive-600">{error}</p>
      ) : cards === null ? (
        <div className="flex items-center gap-2 text-sm text-foreground-light">
          <Loader2 className="animate-spin" size={14} /> Loading…
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-md border border-default bg-surface-100 px-4 py-6 text-center text-sm text-foreground-light">
          No card on file yet.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-md border border-default">
          {cards.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3">
                <CreditCard size={18} className="text-foreground-light" />
                <div className="text-sm">
                  <span className="capitalize text-foreground">{c.brand}</span>{' '}
                  <span className="text-foreground-light">•••• {c.last4}</span>
                  <span className="text-foreground-lighter">
                    {' '}
                    · exp {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                  </span>
                  {c.isDefault && (
                    <span className="ml-2 rounded bg-brand-400/30 px-1.5 py-0.5 text-xs text-brand-600">
                      Default
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!c.isDefault && (
                  <Button
                    type="button"
                    size="tiny"
                    disabled={busy === c.id}
                    onClick={() => act('set_default', c.id, 'Could not update the default card')}
                  >
                    Make default
                  </Button>
                )}
                <Button
                  type="button"
                  size="tiny"
                  icon={<Trash2 />}
                  disabled={busy === c.id}
                  onClick={() => act('remove', c.id, 'Could not remove the card')}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <TaskclanAddCardModal
        visible={showAdd}
        onCancel={() => setShowAdd(false)}
        onDone={() => {
          setShowAdd(false)
          void load()
        }}
      />
    </section>
  )
}
