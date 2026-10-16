/**
 * GET /api/taskclan/github/connect — where to send someone to install the app.
 *
 * Cloud answers with a GitHub App install URL carrying encrypted state (the
 * active org and user), so its callback can attribute the installation to the
 * right organisation. That state is why the URL cannot be assembled in the
 * browser: only Cloud can sign it.
 *
 * `returnTo` is the page the person is on, so GitHub sends them back to it
 * rather than to a default. Cloud reads that as two halves, `origin` and
 * `returnPath`, and validates each against its own allowlist (`*.taskclan.com`
 * hosts, known console paths); this route splits the URL into them and does not
 * second-guess the rest. Sent whole as `returnTo`, Cloud never read it, and
 * every install ended on the engine's old console.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest, inOrg } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { returnTarget } from '@/lib/taskclan/githubReturn'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  const target = returnTarget(req.query.returnTo)
  const qs = target
    ? `?${new URLSearchParams({ origin: target.origin, returnPath: target.returnPath })}`
    : ''

  try {
    // Started from an app (?ref=), the installation belongs to the app's
    // workspace, which need not be the one this request names: Cloud binds
    // it to whichever workspace asks.
    let caller = resolved.caller
    const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
    if (ref) {
      const lookup = await siteForCaller(ref, caller)
      if (!lookup.ok) return res.status(502).json({ error: lookup.detail })
      if (!lookup.data) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })
      if (lookup.data.orgId) caller = inOrg(caller, lookup.data.orgId)
    }

    const r = await fetch(`${cloud.url}/api/cloud/v1/git/connect${qs}`, {
      headers: authHeadersFor(caller),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
