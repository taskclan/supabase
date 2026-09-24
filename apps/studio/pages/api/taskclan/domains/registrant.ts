/**
 * GET/POST /api/taskclan/domains/registrant — the workspace's domain registrant
 * contact (pre-filled on GET, saved on POST). Org-level; forwards the caller to
 * the engine's /api/cloud/v1/domains/registrant.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ error: 'method not allowed' })
  }
  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/domains/registrant`, {
      method: req.method,
      headers: { ...authHeadersFor(resolved.caller), 'content-type': 'application/json' },
      ...(req.method === 'POST' ? { body: JSON.stringify(req.body ?? {}) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.status(r.status).json(await r.json().catch(() => ({})))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(/abort|timeout/i.test(detail) ? 504 : 502).json({
      error: 'could not reach the Cloud API',
      detail,
    })
  }
}
