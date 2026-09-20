/**
 * /api/taskclan/billing/payment-methods — the org's cards on file.
 *
 * Forwards to the engine's owner-gated endpoint (list on GET; setup_intent /
 * confirm / set_default / remove on POST). Card details are collected in the
 * browser by Stripe Elements against the SetupIntent this returns; only
 * payment-method ids ever pass through here.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 20000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/billing/payment-methods`, {
      method: req.method,
      headers: {
        ...authHeadersFor(resolved.caller),
        ...(req.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
