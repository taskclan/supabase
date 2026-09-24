/**
 * POST /api/taskclan/{ref}/domains/register — buy a domain and attach it to this
 * app. Resolves the app by ref and forwards { domain, siteId } to the engine's
 * /api/cloud/v1/domains/register (owner/admin, charges the workspace card).
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

const TIMEOUT_MS = 60000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }
  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  const domain = typeof (req.body as { domain?: unknown })?.domain === 'string' ? (req.body as { domain: string }).domain.trim() : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })
  if (!domain) return res.status(400).json({ error: 'domain is required' })

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

    const r = await fetch(`${cloud.url}/api/cloud/v1/domains/register`, {
      method: 'POST',
      headers: { ...authHeadersFor(caller), 'content-type': 'application/json' },
      body: JSON.stringify({ domain, siteId: site.id }),
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
