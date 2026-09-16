/**
 * GET /api/taskclan/github/repos[?installationId=] — repositories the org's
 * connected GitHub App installations can deploy, for the new-project form's
 * "Import from GitHub" picker.
 *
 * A server route because the Cloud API key is org-wide and must never reach the
 * browser (same reason as the other taskclan proxies). Forwards to Cloud's
 * git/repos and passes the `{ installations, repos }` shape straight through.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { taskclanConfig } from '@/lib/taskclan/client'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const cfg = taskclanConfig()
  if (!cfg.ok) return res.status(501).json({ error: 'not_configured', detail: cfg.reason })

  const installationId = typeof req.query.installationId === 'string' ? req.query.installationId : ''
  const qs = installationId ? `?installationId=${encodeURIComponent(installationId)}` : ''

  try {
    const r = await fetch(`${cfg.config.url}/api/cloud/v1/git/repos${qs}`, {
      headers: { authorization: `Bearer ${cfg.config.key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? 'GitHub listing timed out' : 'could not reach the Cloud API', detail })
  }
}
