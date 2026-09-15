/**
 * GET  /api/taskclan/{ref}/databases — this app's databases + managed plans.
 * POST /api/taskclan/{ref}/databases — provision a managed database, or attach
 *      a bring-your-own connection string.
 *
 * A server route for the same reason as the other taskclan proxies: the Cloud
 * API key is an org-wide credential that must never reach the browser. The page
 * asks by app ref; this route holds the key and forwards to Cloud's databases
 * API for the resolved site.
 *
 * The POST body is passed through: `{ action:'provision', provider, plan, name,
 * envKey }` provisions (Supabase/Neon/Redis), and `{ url, name, envKey }`
 * attaches an existing database. Cloud enforces the wallet charge, the plan
 * whitelist and the write capability — this route only resolves the site and
 * carries the key.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { taskclanConfig } from '@/lib/taskclan/client'
import { findSiteByRef, type CloudSite } from '@/lib/taskclan/projects'

const TIMEOUT_MS = 15000
/** Provisioning creates a real project upstream; give it room without hanging the page. */
const PROVISION_TIMEOUT_MS = 30000

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
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
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
    const base = `${cfg.config.url}/api/cloud/v1/sites/${site.id}/databases`

    if (req.method === 'GET') {
      const r = await fetch(base, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body = await r.json().catch(() => ({}))
      return res.status(r.status).json(body)
    }

    // POST — provision or attach. Pass only the fields Cloud expects.
    const b = (req.body ?? {}) as Record<string, unknown>
    const payload =
      b.action === 'provision'
        ? {
            action: 'provision',
            provider: b.provider,
            engine: b.engine,
            plan: b.plan,
            name: b.name,
            envKey: b.envKey,
          }
        : { url: b.url, name: b.name, envKey: b.envKey }
    const r = await fetch(base, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(b.action === 'provision' ? PROVISION_TIMEOUT_MS : TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    // Pass the engine's human-written refusals straight through (insufficient
    // credits, not configured, invalid connection string).
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
