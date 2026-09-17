/**
 * GET  /api/taskclan/device?code=… — what a pending `taskclan login` is asking for.
 * POST /api/taskclan/device { code } — approve it.
 *
 * Approving mints a Cloud API key for the machine that asked, scoped to the
 * caller's active organisation. That makes this the most consequential thing
 * the console can do on a single click, so two properties matter more here than
 * anywhere else in these proxies.
 *
 * It must run as the *user*, never the shared key. The engine reads the org and
 * the role from the bearer, so under the fallback key every approval would
 * silently grant access to the key owner's org — to whoever happened to be
 * looking at the screen. The shared-key path is refused outright rather than
 * left to the engine, because "it would probably fail" is not the standard for
 * a credential-granting endpoint.
 *
 * And the engine's refusals pass through unflattened. "Your role cannot approve
 * deploy access" is the difference between a person asking an admin and a
 * person retrying forever.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  // Deliberately stricter than the other proxies: no shared-key fallback.
  //
  // Everywhere else the fallback means "show this person the org the console is
  // configured for", which is wrong but readable. Here it would mean granting a
  // machine long-lived access to an org chosen by a server env var rather than
  // by the person clicking approve.
  if (resolved.caller.kind !== 'user') {
    return res.status(401).json({
      error: 'sign in to approve a device',
    })
  }

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  const auth = authHeadersFor(resolved.caller)

  try {
    if (method === 'GET') {
      const raw = req.query.code
      const code = (Array.isArray(raw) ? raw[0] : (raw ?? '')).trim()
      if (!code) return res.status(200).json({ found: false })

      const r = await fetch(
        `${cloud.url}/api/cloud/v1/auth/device/approve?code=${encodeURIComponent(code)}`,
        { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) }
      )
      const body = await r.json().catch(() => ({}))
      return res.status(r.status).json(body)
    }

    const payload = (req.body ?? {}) as { code?: unknown }
    const code = typeof payload.code === 'string' ? payload.code.trim() : ''
    if (!code) return res.status(400).json({ error: 'code is required' })

    const r = await fetch(`${cloud.url}/api/cloud/v1/auth/device/approve`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    res.setHeader('cache-control', 'no-store')
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    // Not optimistic on a timeout. An approval that may or may not have landed
    // must not be reported as done: the CLI would keep waiting while the screen
    // said it had succeeded.
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? 'the Cloud API did not answer in time, so the device may or may not be approved'
        : 'could not reach the Cloud API',
      detail,
    })
  }
}
