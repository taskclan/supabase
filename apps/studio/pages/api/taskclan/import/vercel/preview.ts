/**
 * POST /api/taskclan/import/vercel/preview — preview a Vercel project import.
 *
 * Forwards `{ token, project, teamId?, hasVercelJson? }` to the engine's
 * `import/vercel/preview`, which reads the project (and its env, when readable)
 * under the token and answers `{ ok, plan, summary }`. The plan is read-only: it
 * names what comes across and what will not survive the move. Env VALUES are not
 * returned — only whether each can be copied — so no secret rounds through here.
 *
 * The Vercel token is used only for this request and is neither stored nor logged.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 15000

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
    const r = await fetch(`${cloud.url}/api/cloud/v1/import/vercel/preview`, {
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
