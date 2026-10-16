/**
 * GET /api/taskclan/agents/intents — release intents for the caller's org.
 *
 * Under the caller's own token, so the list is their organisation's releases
 * and not whichever org a server key happens to belong to. The shared-key
 * fallback is allowed here because reading the release log is not a privileged
 * act, and a console configured without per-user auth still needs the screen to
 * render.
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

  const status = typeof req.query.status === 'string' ? req.query.status : ''
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/agents/intents${qs}`, {
      headers: authHeadersFor(resolved.caller),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    res.setHeader('cache-control', 'no-store')
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(/abort|timeout/i.test(detail) ? 504 : 502).json({
      error: 'could not reach the Cloud API',
      detail,
    })
  }
}
