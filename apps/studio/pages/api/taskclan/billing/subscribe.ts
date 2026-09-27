/**
 * POST /api/taskclan/billing/subscribe — start or manage a plan subscription.
 *
 * Forwards to the engine's owner-gated billing endpoint:
 *   { action: 'upgrade', plan } — first-time subscribe returns { checkoutUrl }
 *     (Stripe Checkout, subscription mode); an org that already subscribes gets
 *     { portalUrl, manage: true } (cancel there); 'free' downgrades in place;
 *     'enterprise' returns { contactSales: true }.
 *   { action: 'preview_switch', plan } — a subscriber's prorated price for
 *     another paid plan, { preview }; changes nothing.
 *   { action: 'upgrade', plan, confirm: true, prorationDate } — the subscriber
 *     confirmed that price: the engine switches the subscription in place and
 *     settles it at once, { ok, switched, settledUsd }.
 *   { action: 'portal' } — cancel, change the card, read invoices: { portalUrl }.
 *
 * Card details never touch this console — the customer lands on Stripe's own
 * hosted Checkout or billing portal.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 20000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/billing`, {
      method: 'POST',
      headers: { ...authHeadersFor(resolved.caller), 'content-type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
