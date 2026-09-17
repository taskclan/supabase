/**
 * POST /api/taskclan/{ref}/deploy-from-repo — link a repo to an app and build it.
 *
 * Distinct from `POST {ref}/deployments`, which is the Deploy button and sends a
 * deliberately empty body so it can only ever rebuild whatever the app is
 * already linked to. This route carries a repo, so it can *change* what an app
 * builds from. That is the right thing for the create form, where picking the
 * repo is the explicit action the user just took, and the wrong thing for a
 * one-click redeploy. Keeping them apart is what stops the second from quietly
 * becoming the first.
 *
 * The two app types deploy through different engine endpoints, and only one of
 * them has a container to size:
 *
 *   service → `deploy-service` (repo, branch, instance size, autoscaling)
 *   static  → `deploy` (repo only; the engine reads the files and serves them)
 *
 * Sizing is re-clamped here even though the form clamps it too. The engine
 * silently rewrites an out-of-range count rather than rejecting it, so an
 * unclamped value would be accepted, changed, and reported back as success.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

/** Long enough for the engine to queue a build; the build itself is polled. */
const DEPLOY_TIMEOUT_MS = 30000

interface Body {
  repo?: unknown
  branch?: unknown
  type?: unknown
  installationId?: unknown
  instanceType?: unknown
  autoscale?: unknown
  maxInstances?: unknown
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  const body = (req.body ?? {}) as Body
  const repo = typeof body.repo === 'string' ? body.repo.trim() : ''
  if (!repo) return res.status(400).json({ error: 'repo is required' })

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const lookup = await siteForCaller(ref, caller)
    if (!lookup.ok) return res.status(502).json({ error: lookup.detail })
    const site = lookup.data
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })

    const auth = { ...authHeadersFor(caller), 'content-type': 'application/json' }
    const isStatic = body.type === 'static'

    if (isStatic) {
      const r = await fetch(`${cloud.url}/api/cloud/v1/sites/${site.id}/deploy`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ repo }),
        signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
      })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) return res.status(r.status).json(out)
      return res.status(202).json(out)
    }

    const autoscale = body.autoscale === true
    // Deliberately no ceiling applied here.
    //
    // The first version of this route clamped to a hardcoded 10. The engine's
    // real ceiling is 20 and its plan limit is separate again, so that clamp
    // silently trimmed legitimate requests — which is precisely the behaviour
    // `clampMaxInstances` exists to prevent, reintroduced one layer down. This
    // route has no way to learn either limit without an extra round trip, so
    // it normalises the shape and leaves the limits to the two places that
    // actually know them: the form, which clamps against the live catalogue and
    // shows the result, and the engine, which enforces the plan with a message
    // naming it.
    const requested = Number(body.maxInstances)
    const maxInstances = autoscale
      ? Math.max(2, Number.isInteger(requested) ? requested : 3)
      : 1

    const payload: Record<string, unknown> = { repo, autoscale, maxInstances }
    if (typeof body.branch === 'string' && body.branch.trim()) payload.ref = body.branch.trim()
    if (typeof body.instanceType === 'string' && body.instanceType) payload.plan = body.instanceType
    if (Number.isInteger(body.installationId)) payload.installationId = body.installationId

    const r = await fetch(`${cloud.url}/api/cloud/v1/sites/${site.id}/deploy-service`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
    })
    const out = await r.json().catch(() => ({}))
    // The engine refuses with a sentence written for a person — an instance size
    // above the plan, a repo the GitHub App cannot read — so pass it through.
    if (!r.ok) return res.status(r.status).json(out)
    return res.status(202).json(out)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'the Cloud API did not answer in time' : 'could not reach the Cloud API',
      detail,
    })
  }
}
