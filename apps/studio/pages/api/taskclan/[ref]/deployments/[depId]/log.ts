/**
 * GET /api/taskclan/{ref}/deployments/{depId}/log — one deployment's build
 * progress: its status, phase, computed build stages, and the streamed build log.
 *
 * The deployments list is deliberately lightweight (no logs); this is the detail
 * behind one row, polled by the console while a build is in flight so a person
 * can watch it happen instead of staring at "Building". Same auth model as the
 * list: the Cloud key stays on the server, the app is resolved by ref, a
 * signed-in caller is forwarded under their own token.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  const depId = typeof req.query.depId === 'string' ? req.query.depId : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })
  if (!depId) return res.status(400).json({ error: 'missing deployment id' })

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

    const r = await fetch(
      `${cloud.url}/api/cloud/v1/sites/${site.id}/deployments/${encodeURIComponent(depId)}/log`,
      { headers: authHeadersFor(caller), signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
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
