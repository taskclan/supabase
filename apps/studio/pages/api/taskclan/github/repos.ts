/**
 * GET /api/taskclan/github/repos[?installationId=] — repositories the org's
 * connected GitHub App installations can deploy, for the new-project form's
 * "Import from GitHub" picker.
 *
 * A server route because the Cloud API key is org-wide and must never reach the
 * browser (same reason as the other taskclan proxies). Forwards to Cloud's
 * git/repos and passes the `{ installations, repos }` shape straight through.
 *
 * Resolves a caller like the rest of them. This one sits outside `[ref]/` and
 * was missed when the others were converted, so it was still reading the shared
 * key directly: a signed-in person would have listed the key's repositories
 * rather than their own.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

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

  const installationId =
    typeof req.query.installationId === 'string' ? req.query.installationId : ''
  const qs = installationId ? `?installationId=${encodeURIComponent(installationId)}` : ''

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/git/repos${qs}`, {
      headers: authHeadersFor(resolved.caller),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res
      .status(timedOut ? 504 : 502)
      .json({
        error: timedOut ? 'GitHub listing timed out' : 'could not reach the Cloud API',
        detail,
      })
  }
}
