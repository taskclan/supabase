/**
 * GET  /api/taskclan/{ref}/deployments — this app's deploy history.
 * POST /api/taskclan/{ref}/deployments — ship the current branch.
 *
 * A server route rather than a browser fetch, for one reason: the Cloud API key
 * is an org-wide credential that can read every app's env and deploy every app.
 * It must never be handed to a page. The browser asks this route by app ref;
 * this route is the only thing that holds the key.
 *
 * The POST body is deliberately empty. `deploy-service` falls back to the
 * site's linked repo, branch and installation when none is given, which is
 * exactly what a redeploy means — and it also means the console cannot be used
 * to point an app at a different repo, which is a change that should go through
 * the git settings screen with its own confirmation, not a Deploy button.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { taskclanConfig } from '@/lib/taskclan/client'
import { findSiteByRef, type CloudSite } from '@/lib/taskclan/projects'
import { withCloudSession } from '@/lib/taskclan/session'

const TIMEOUT_MS = 15000
/** Long enough for the engine to queue a build; the build itself is watched by polling. */
const DEPLOY_TIMEOUT_MS = 30000

async function siteForRef(
  ref: string,
  cfg: { url: string; key: string }
): Promise<CloudSite | null> {
  const res = await fetch(`${cfg.url}/api/cloud/v1/sites`, {
    headers: { authorization: `Bearer ${cfg.key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { sites?: CloudSite[] }
  return findSiteByRef(Array.isArray(body.sites) ? body.sites : [], ref) ?? null
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    if (req.method === 'GET') {
      const r = await fetch(`${cfg.config.url}/api/cloud/v1/sites/${site.id}/deployments?limit=25`, {
        headers: auth,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) return res.status(r.status).json(body)
      // The live URL travels with the history so the page can link to the app
      // without a second round trip, and so "deployed" and "reachable" are
      // shown from the same payload rather than two that can disagree.
      return res.status(200).json({
        ...(body as object),
        site: { id: site.id, name: site.name, liveUrl: site.liveUrl ?? site.host ?? null },
      })
    }

    const r = await fetch(`${cfg.config.url}/api/cloud/v1/sites/${site.id}/deploy-service`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) {
      // The engine's refusals are written for a person — "this deployment is
      // not linked to a git repo", "your role cannot deploy to production" —
      // so pass them through rather than flattening to "deploy failed".
      return res.status(r.status).json(body)
    }
    return res.status(202).json(body)
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
