/**
 * POST /api/taskclan/{ref}/provision-supabase-oauth — begin the one-click
 * "provision into your own Supabase" flow.
 *
 * The console and the engine are different origins, and the OAuth state is
 * signed with a secret only the engine holds, so the console cannot build the
 * authorize URL itself. This route (holding the Cloud key) asks the engine to
 * mint it for the resolved site, and returns the URL for the browser to open.
 * The engine's callback provisions and redirects back to `returnUrl`.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { taskclanConfig } from '@/lib/taskclan/client'
import { findSiteByRef, type CloudSite } from '@/lib/taskclan/projects'
import { withCloudSession } from '@/lib/taskclan/session'

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  const body = (req.body ?? {}) as { plan?: string; name?: string; returnUrl?: string }
  if (!body.returnUrl) return res.status(400).json({ error: 'returnUrl is required' })

  const cfg = taskclanConfig()
  if (!cfg.ok) return res.status(501).json({ error: 'not_configured', detail: cfg.reason })

  try {
    const site = await siteForRef(ref, cfg.config)
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })

    const q = new URLSearchParams({
      siteId: site.id,
      plan: body.plan || 'starter',
      returnUrl: body.returnUrl,
    })
    if (body.name) q.set('name', body.name)

    const r = await fetch(
      `${cfg.config.url}/api/taskclan/integrations/oauth/supabase/authorize?${q.toString()}`,
      {
        headers: { authorization: `Bearer ${cfg.config.key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    const payload = await r.json().catch(() => ({}))
    // Pass the engine's status through (501 when OAuth isn't enabled, etc.).
    return res.status(r.status).json(payload)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'the Cloud API did not answer in time' : 'could not reach the Cloud API',
      detail,
    })
  }
}

export default withCloudSession(handler)
