/**
 * GET /api/taskclan/{ref}/container-logs — what the app's container printed at
 * runtime (its own stdout and stderr), plus a plain-English hint when the output
 * matches a known startup failure.
 *
 * This is the runtime counterpart to the build log on the Deployments page. When
 * a container starts and then exits — the most common first-deploy failure — the
 * edge only ever says "internal error connecting to the port", and the reason
 * lives in the process's own output and nowhere else. Until this endpoint that
 * output was unreachable from the console, which made a crash impossible to
 * diagnose without the Cloud API key.
 *
 * Same auth model as the deployments proxy: the Cloud key stays on the server,
 * the app is resolved by ref, and a signed-in caller is forwarded under their
 * own token so the engine can scope the read to an app they actually own.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

const TIMEOUT_MS = 20000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  // The engine clamps this to 1..720 minutes; we pass it through untouched and
  // let that single source of truth own the bounds.
  const minutes = typeof req.query.minutes === 'string' ? req.query.minutes : ''

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

    const qs = minutes ? `?minutes=${encodeURIComponent(minutes)}` : ''
    const r = await fetch(`${cloud.url}/api/cloud/v1/sites/${site.id}/container-logs${qs}`, {
      headers: authHeadersFor(caller),
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
