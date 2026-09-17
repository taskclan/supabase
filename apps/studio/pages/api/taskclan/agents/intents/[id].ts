/**
 * GET  /api/taskclan/agents/intents/[id] — one release, its trail and the
 *      deployment it produced.
 * POST /api/taskclan/agents/intents/[id] { action: 'approve' | 'decline', note? }
 *
 * Approving starts a production deploy, so this refuses the shared-key path the
 * way the device endpoint does. Under the fallback key every approval would be
 * recorded against the key owner and satisfy a signature requirement on behalf
 * of somebody who never saw it — which defeats the entire point of a rule that
 * asks for two people.
 *
 * The engine's refusals pass through unflattened. "You have already approved
 * this intent", "this intent is superseded — there is nothing to decide" and a
 * role refusal are three different things a person can act on; "could not
 * approve" is none of them.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 20000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  // Reading under the fallback is fine; deciding is not.
  if (method === 'POST' && resolved.caller.kind !== 'user') {
    return res.status(401).json({ error: 'sign in to approve or decline a release' })
  }

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  const raw = req.query.id
  const id = (Array.isArray(raw) ? raw[0] : (raw ?? '')).trim()
  if (!id) return res.status(400).json({ error: 'a release reference is required' })

  const auth = authHeadersFor(resolved.caller)
  const target = `${cloud.url}/api/cloud/v1/agents/intents/${encodeURIComponent(id)}`

  try {
    if (method === 'GET') {
      const r = await fetch(target, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body = await r.json().catch(() => ({}))
      res.setHeader('cache-control', 'no-store')
      return res.status(r.status).json(body)
    }

    const payload = (req.body ?? {}) as { action?: unknown; note?: unknown }
    const action = typeof payload.action === 'string' ? payload.action : ''
    if (action !== 'approve' && action !== 'decline') {
      return res.status(400).json({ error: 'action must be approve or decline' })
    }

    const r = await fetch(target, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        action,
        note: typeof payload.note === 'string' ? payload.note : undefined,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    res.setHeader('cache-control', 'no-store')
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    // Not optimistic on a timeout. An approval that may or may not have landed
    // must not read as done: the grant is spent once, and telling somebody it
    // failed when it succeeded invites a second approval that cannot happen.
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? 'the Cloud API did not answer in time, so this release may or may not have been decided'
        : 'could not reach the Cloud API',
      detail,
    })
  }
}
