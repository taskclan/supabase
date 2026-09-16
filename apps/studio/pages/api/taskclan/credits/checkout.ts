/**
 * POST /api/taskclan/credits/checkout { packId } — start a credit top-up.
 *
 * Returns Stripe's hosted checkout URL; the browser navigates to it. Nothing
 * about a card touches this console, which is the point of doing it this way
 * rather than collecting payment details here.
 *
 * `packId` is passed through rather than validated against a list, because the
 * catalogue lives on Cloud and duplicating it here would create a second place
 * for prices to be wrong. An unknown pack is Cloud's refusal to give.
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

  const packId = (req.body as { packId?: unknown })?.packId
  if (typeof packId !== 'string' || !packId) {
    return res.status(400).json({ error: 'packId is required' })
  }

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/credits/checkout`, {
      method: 'POST',
      headers: { ...authHeadersFor(resolved.caller), 'content-type': 'application/json' },
      body: JSON.stringify({ packId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
