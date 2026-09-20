/**
 * POST /api/taskclan/import/run — reproduce a source app on Taskclan Cloud.
 *
 * Forwards the run body to the engine's `import/run`, which rebuilds the plan
 * server-side from the source-platform token in the body (so config-var VALUES
 * never round-trip through the browser), creates the site, copies config,
 * connects/provisions the database, and kicks off the build. It answers
 * `{ ok, result: { siteId, deploymentId, copiedEnvCount, database, pipeline,
 * flagged, ... } }` with a 202 once the build is queued.
 *
 * A longer budget than the previews: this creates a site and starts a build
 * before it answers, where a preview only reads.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 30000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/import/run`, {
      method: 'POST',
      headers: { ...authHeadersFor(resolved.caller), 'content-type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
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
