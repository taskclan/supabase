/**
 * Payment history — the org's postpaid monthly invoices, with the invoice PDF
 * and the payment receipt to download. Prepaid orgs have none (their credit
 * purchases get a Stripe receipt by email).
 */
import { Download, ExternalLink, Loader2, Receipt } from 'lucide-react'
import { useEffect, useState } from 'react'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface Invoice {
  period_start: string
  period_end: string
  amount_usd: number
  credits_applied_usd: number
  currency: string
  status: string
  hosted_url: string | null
  pdf_url: string | null
  receipt_url: string | null
  created_at: string
}

const money = (n: number) => `$${Number(n ?? 0).toFixed(2)}`
const shortDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}
const periodLabel = (s: string, e: string) => {
  try {
    const start = new Date(`${s}T00:00:00Z`)
    const endIncl = new Date(new Date(`${e}T00:00:00Z`).getTime() - 86400000)
    const f = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    return `${f(start)} – ${f(endIncl)}`
  } catch {
    return `${s} – ${e}`
  }
}
const statusClass = (s: string) =>
  s === 'paid'
    ? 'text-brand-600'
    : s === 'open'
      ? 'text-warning-600'
      : s === 'uncollectible' || s === 'void'
        ? 'text-destructive-600'
        : 'text-foreground-light'

export const TaskclanInvoices = () => {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch('/api/taskclan/billing/invoices')
        const body = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) setError(body?.error ?? `Could not load invoices (${res.status})`)
        else setInvoices(Array.isArray(body?.invoices) ? (body.invoices as Invoice[]) : [])
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load invoices')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-base text-foreground">Payment history</h3>
        <p className="text-sm text-foreground-light">
          Your monthly invoices, with the invoice and payment receipt to download.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive-600">{error}</p>
      ) : invoices === null ? (
        <div className="flex items-center gap-2 text-sm text-foreground-light">
          <Loader2 className="animate-spin" size={14} /> Loading…
        </div>
      ) : invoices.length === 0 ? (
        <div className="rounded-md border border-default bg-surface-100 px-4 py-6 text-center text-sm text-foreground-light">
          No invoices yet. Once you&apos;re on pay-as-you-go, a monthly invoice appears here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-default">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-default text-left text-xs uppercase text-foreground-lighter">
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Download</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={i} className="border-b border-default last:border-0">
                  <td className="px-4 py-3 text-foreground">{periodLabel(inv.period_start, inv.period_end)}</td>
                  <td className="px-4 py-3 text-foreground-light">{shortDate(inv.created_at)}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {money(inv.amount_usd)}
                    {inv.credits_applied_usd > 0 && (
                      <span className="text-foreground-lighter"> (−{money(inv.credits_applied_usd)} credits)</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 capitalize ${statusClass(inv.status)}`}>{inv.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      {inv.pdf_url && (
                        <a
                          href={inv.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-foreground-light hover:text-foreground"
                        >
                          <Download size={13} /> Invoice
                        </a>
                      )}
                      {inv.receipt_url && (
                        <a
                          href={inv.receipt_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-foreground-light hover:text-foreground"
                        >
                          <Receipt size={13} /> Receipt
                        </a>
                      )}
                      {inv.hosted_url && !inv.pdf_url && (
                        <a
                          href={inv.hosted_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-foreground-light hover:text-foreground"
                        >
                          <ExternalLink size={13} /> View
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
