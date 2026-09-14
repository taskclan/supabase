/**
 * POST /api/taskclan/{ref}/deploy-mode — switch an app between auto and manual.
 *
 * Every Cloud app is `manual` today: a merge to main opens an intent and waits.
 * That is the right default for a platform running someone else's money, but it
 * is only defensible if flipping it back is one visible control rather than an
 * API call somebody has to be told about.
 *
 * Same reason as ./deployments.ts for being a server route: the Cloud API key
 * deploys every app in the org and must not reach a page.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { taskclanConfig } from '@/lib/taskclan/client'
import { findSiteByRef, type CloudSite } from '@/lib/taskclan/projects'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  const mode = (req.body as { mode?: unknown })?.mode
  // Rejected rather than defaulted, matching the engine's own handler: silently
  // defaulting an unrecognised value would turn a typo into a live app that
  // ships on every merge.
  if (mode !== 'auto' && mode !== 'manual') {
    return res.status(400).json({ error: "mode must be 'auto' or 'manual'" })
  }

  const cfg = taskclanConfig()
  if (!cfg.ok) return res.status(501).json({ error: 'not_configured', detail: cfg.reason })

  try {
    const listed = await fetch(`${cfg.config.url}/api/cloud/v1/sites`, {
      headers: { authorization: `Bearer ${cfg.config.key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!listed.ok) return res.status(502).json({ error: 'could not list Taskclan apps' })
    const body = (await listed.json()) as { sites?: CloudSite[] }
    const site = findSiteByRef(Array.isArray(body.sites) ? body.sites : [], ref)
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })

    const r = await fetch(`${cfg.config.url}/api/cloud/v1/sites/${site.id}/deploy-mode`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.config.key}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const out = await r.json().catch(() => ({}))
    return res.status(r.status).json(out)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
