/**
 * GET/POST/DELETE /api/taskclan/{ref}/env — an app's environment variables.
 *
 * A server proxy, so no credential reaches the browser: a signed-in caller's
 * own token is forwarded, and the shared Cloud key stays server side entirely.
 * It resolves the app by ref and forwards to Cloud's per-site env API, which
 * enforces the write capability and masks secret values (reveal is gated on the
 * caller's role). Lets the console manage per-app secrets instead of curl.
 *
 *   GET     -> { env: [{ key, value|masked, isSecret, scope }...], canWrite }
 *   POST    { key, value, isSecret?, scope? }  -> upsert
 *   DELETE  { key, scope? }                    -> remove
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST, DELETE')
    return res.status(405).json({ error: 'method not allowed' })
  }
  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const lookup = await siteForCaller(ref, caller)
    // Distinguish "no such app for this caller" from "could not reach Cloud":
    // answering 404 for an outage tells someone their app has vanished.
    if (!lookup.ok) return res.status(502).json({ error: lookup.detail })
    const site = lookup.data
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })
    const auth = authHeadersFor(caller)
    // `?reveal=1` on GET asks Cloud for real secret values (it gates that on role).
    const reveal = req.query.reveal === '1' ? '?reveal=1' : ''
    const base = `${cloud.url}/api/cloud/v1/sites/${site.id}/env`

    if (req.method === 'GET') {
      const r = await fetch(`${base}${reveal}`, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body = await r.json().catch(() => ({}))
      return res.status(r.status).json(body)
    }

    const method = req.method as 'POST' | 'DELETE'
    const b = (req.body ?? {}) as Record<string, unknown>
    const payload =
      method === 'POST'
        ? { key: b.key, value: b.value ?? '', isSecret: b.isSecret === true, scope: b.scope ?? 'production' }
        : { key: b.key, scope: b.scope ?? 'production' }
    const r = await fetch(base, {
      method,
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
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
