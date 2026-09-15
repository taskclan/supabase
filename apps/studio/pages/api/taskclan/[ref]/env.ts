/**
 * GET/POST/DELETE /api/taskclan/{ref}/env — an app's environment variables.
 *
 * A server proxy holding the Cloud key (never handed to the browser). It
 * resolves the app by ref and forwards to Cloud's per-site env API, which
 * enforces the write capability and masks secret values (reveal is gated on the
 * caller's role). Lets the console manage per-app secrets instead of curl.
 *
 *   GET     -> { env: [{ key, value|masked, isSecret, scope }...], canWrite }
 *   POST    { key, value, isSecret?, scope? }  -> upsert
 *   DELETE  { key, scope? }                    -> remove
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { taskclanConfig } from '@/lib/taskclan/client'
import { findSiteByRef, type CloudSite } from '@/lib/taskclan/projects'

const TIMEOUT_MS = 15000

async function siteForRef(ref: string, cfg: { url: string; key: string }): Promise<CloudSite | null> {
  const res = await fetch(`${cfg.url}/api/cloud/v1/sites`, {
    headers: { authorization: `Bearer ${cfg.key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { sites?: CloudSite[] }
  return findSiteByRef(Array.isArray(body.sites) ? body.sites : [], ref) ?? null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST, DELETE')
    return res.status(405).json({ error: 'method not allowed' })
  }
  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  const cfg = taskclanConfig()
  if (!cfg.ok) return res.status(501).json({ error: 'not_configured', detail: cfg.reason })

  try {
    const site = await siteForRef(ref, cfg.config)
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })
    const auth = { authorization: `Bearer ${cfg.config.key}`, accept: 'application/json' }
    // `?reveal=1` on GET asks Cloud for real secret values (it gates that on role).
    const reveal = req.query.reveal === '1' ? '?reveal=1' : ''
    const base = `${cfg.config.url}/api/cloud/v1/sites/${site.id}/env`

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
