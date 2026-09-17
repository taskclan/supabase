/**
 * GET  /api/taskclan/keys — the org's Cloud API keys (metadata only).
 * POST /api/taskclan/keys — mint one. The plaintext comes back exactly once.
 *
 * Keys are org-scoped, and the engine scopes them by the caller's active org,
 * so this must go out under the caller's own token. Under the shared key it
 * would list — and mint into — the key owner's org for everybody, which for a
 * credential-issuing endpoint is the worst version of that bug.
 *
 * The plaintext is deliberately not logged, cached or echoed anywhere but the
 * response body. The engine stores only a SHA-256 hash, so this response is the
 * single moment the value exists outside the caller's browser.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 15000
/** The engine's own cap; trimming here avoids a round trip to be told. */
const MAX_NAME = 80

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  const auth = authHeadersFor(resolved.caller)

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${cloud.url}/api/cloud/v1/keys`, {
        headers: auth,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body = await r.json().catch(() => ({}))
      return res.status(r.status).json(body)
    }

    const raw = (req.body ?? {}) as { name?: unknown }
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : ''

    const r = await fetch(`${cloud.url}/api/cloud/v1/keys`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(name ? { name } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    // No-store on the way back as well as the way out. This body carries the
    // only copy of a credential, and it must not sit in an intermediary.
    res.setHeader('cache-control', 'no-store')
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'the Cloud API did not answer in time' : 'could not reach the Cloud API',
      detail,
    })
  }
}
