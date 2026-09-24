/**
 * GET /api/taskclan/domains/search?q= — search buyable domains + resale prices.
 * Org-level (not per-app): forwards the signed-in caller to the engine's
 * /api/cloud/v1/domains/search. The Cloud key stays on the server.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

const TIMEOUT_MS = 20000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.status(400).json({ error: 'q is required' })

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/domains/search?q=${encodeURIComponent(q)}`, {
      headers: authHeadersFor(resolved.caller),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.status(r.status).json(await r.json().catch(() => ({})))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(/abort|timeout/i.test(detail) ? 504 : 502).json({
      error: 'could not reach the Cloud API',
      detail,
    })
  }
}
