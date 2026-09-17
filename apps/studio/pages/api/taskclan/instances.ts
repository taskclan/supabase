/**
 * GET /api/taskclan/instances — the container size ladder for the create form.
 *
 * Forwarded rather than reshaped, for the same reason as `credits`: the engine
 * is the side that knows which sizes a plan may provision and what they cost,
 * and a second copy of that judgement here would drift from the price list.
 *
 * Note that `locked` and `autoscale.max` in the response are scoped to the
 * *caller's* plan, so this must go out under the caller's own token. Under the
 * shared key it would describe the key owner's entitlement to everybody.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/instances`, {
      headers: authHeadersFor(resolved.caller),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
