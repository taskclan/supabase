/**
 * POST /api/taskclan/keys/{id}/revoke — revoke a Cloud API key.
 *
 * Forwarded under the caller's own token, which is what scopes the revoke to
 * their org. The engine matches the key id *and* the org before updating, and
 * answers 404 when either misses, so one org cannot revoke another's key by
 * guessing an id — and the refusal does not confirm the id exists.
 *
 * Immediate and irreversible: the engine stamps `revoked_at` and
 * `resolveApiKeyOrg` stops matching the hash, so anything holding the key is
 * unauthenticated on its next request. The confirmation that precedes this
 * lives in the UI; there is nothing to undo here.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const id = typeof req.query.id === 'string' ? req.query.id : ''
  if (!id) return res.status(400).json({ error: 'missing key id' })

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const r = await fetch(
      `${cloud.url}/api/cloud/v1/keys/${encodeURIComponent(id)}/revoke`,
      {
        method: 'POST',
        headers: authHeadersFor(resolved.caller),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    const body = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(r.status).json(body)
    return res.status(200).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    // Deliberately not optimistic. A revoke that timed out may or may not have
    // landed, and reporting success would leave someone believing a leaked key
    // is dead when it is still live.
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? 'the Cloud API did not answer in time, so the key may or may not be revoked'
        : 'could not reach the Cloud API',
      detail,
    })
  }
}
