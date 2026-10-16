/**
 * GET    /api/taskclan/{ref}/domains — custom domains, with live DNS + cert state.
 * POST   /api/taskclan/{ref}/domains — attach one.
 * DELETE /api/taskclan/{ref}/domains — detach one.
 *
 * A thin forward, because the engine's version of this is doing far more than
 * storage: it re-reads each hostname's certificate and DCV state from
 * Cloudflare on every GET, merges domains bound straight to the app's Worker
 * with those going through the SaaS fallback, and checks whether each DNS
 * record it asked for has actually appeared. Reshaping any of that here would
 * mean keeping a second model of Cloudflare's state in sync with the first.
 *
 * The engine also owns the rules worth not duplicating: which hostnames are
 * reserved, whether the caller's role may attach a domain, and what Cloudflare
 * said when a bind failed. Its refusals are written for a person, so they are
 * passed through rather than flattened.
 *
 * Longer timeout than the other proxies on purpose. A GET here fans out to
 * Cloudflare and to DNS for every attached hostname, so it is legitimately
 * slower than a database read, and timing it out at the console's usual 15s
 * would report a working screen as broken.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

const TIMEOUT_MS = 25000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const lookup = await siteForCaller(ref, caller)
    // "Could not look" is not "no such app": during a Cloud outage a 404 here
    // would read as the app having been deleted.
    if (!lookup.ok) return res.status(502).json({ error: lookup.detail })
    const site = lookup.data
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })

    const auth = authHeadersFor(caller)
    const url = `${cloud.url}/api/cloud/v1/sites/${site.id}/domains`

    if (method === 'GET') {
      const r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body = await r.json().catch(() => ({}))
      return res.status(r.status).json(body)
    }

    const raw = (req.body ?? {}) as { domain?: unknown }
    const domain = typeof raw.domain === 'string' ? raw.domain.trim() : ''
    if (!domain) return res.status(400).json({ error: 'domain is required' })

    const r = await fetch(url, {
      method,
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ domain }),
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
