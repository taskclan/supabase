/**
 * GET /api/taskclan/{ref}/overview — the app's status, compute, repo and last
 * deploy, in one payload for the project home page.
 *
 * Server-side for the same reason as the other taskclan routes: the Cloud API
 * key deploys and reads every app in the org and must not reach the browser.
 *
 * Three upstream calls, in parallel — site detail, git link, recent deploys —
 * collapsed into one response so the home page makes a single request rather
 * than three that can each fail differently.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { buildOverview, type CloudGit, type CloudSiteDetail } from '@/lib/taskclan/overview'
import type { CloudDeployment } from '@/lib/taskclan/deployments'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  const auth = authHeadersFor(caller)
  const api = (path: string) =>
    fetch(`${cloud.url}${path}`, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) })

  try {
    const lookup = await siteForCaller(ref, caller)
    // Distinguish "no such app for this caller" from "could not reach Cloud":
    // answering 404 for an outage tells someone their app has vanished.
    if (!lookup.ok) return res.status(502).json({ error: lookup.detail })
    const site = lookup.data
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })

    // git and deployments are allowed to fail independently: an app can be real
    // and healthy with no repo linked yet, and the overview should still render.
    const [detailRes, gitRes, depRes] = await Promise.all([
      api(`/api/cloud/v1/sites/${site.id}`),
      api(`/api/cloud/v1/sites/${site.id}/git`).catch(() => null),
      api(`/api/cloud/v1/sites/${site.id}/deployments?limit=5`).catch(() => null),
    ])

    if (!detailRes.ok) return res.status(502).json({ error: 'could not read the app' })
    const detailBody = (await detailRes.json()) as { site?: CloudSiteDetail } & CloudSiteDetail
    const detail = (detailBody.site ?? detailBody) as CloudSiteDetail

    const git =
      gitRes && gitRes.ok
        ? (((await gitRes.json()) as { git?: CloudGit }).git ?? null)
        : null
    const deployments =
      depRes && depRes.ok
        ? (((await depRes.json()) as { deployments?: CloudDeployment[] }).deployments ?? [])
        : []

    return res.status(200).json(buildOverview(detail, git, deployments))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'the Cloud API did not answer in time' : 'could not reach the Cloud API',
      detail,
    })
  }
}
