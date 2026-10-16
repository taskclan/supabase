/**
 * GET    /api/taskclan/{ref}/site — this app's identity, for the settings panel.
 * DELETE /api/taskclan/{ref}/site — destroy the app.
 *
 * The delete is the reason this route resolves the ref through `siteForCaller`
 * rather than trusting whatever id the browser sends. The engine authorises a
 * delete against the caller's org, so a cross-tenant attempt would already be
 * refused there; resolving here as well means the console never *addresses* an
 * app the caller cannot see, and the refusal is a 404 that does not confirm the
 * app exists.
 *
 * There is deliberately no PATCH. The engine has no rename endpoint
 * (`sites/[id]` is GET and DELETE only), and a rename field that silently did
 * nothing would be worse than its absence.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

/** Tearing down a container and its DNS takes longer than a read. */
const DELETE_TIMEOUT_MS = 30000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, DELETE')
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
    // "Could not look" is not "does not exist". Reporting an outage as a 404
    // would tell someone their app had been deleted.
    if (!lookup.ok) return res.status(502).json({ error: lookup.detail })
    const site = lookup.data
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })

    const auth = authHeadersFor(caller)

    if (req.method === 'GET') {
      // Served from the caller's own site list rather than re-fetching the
      // engine: the list is the thing tenancy was checked against, so reading
      // anything else here would be reading around that check.
      return res.status(200).json({
        site: {
          id: site.id,
          name: site.name,
          subdomain: site.subdomain ?? null,
          host: site.host ?? null,
          customDomain: site.customDomain ?? null,
          status: site.status ?? null,
          type: site.type ?? null,
          region: site.region ?? null,
          createdAt: site.createdAt ?? null,
          liveUrl: site.liveUrl ?? site.host ?? null,
        },
      })
    }

    const r = await fetch(`${cloud.url}/api/cloud/v1/sites/${site.id}`, {
      method: 'DELETE',
      headers: auth,
      signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    })
    const body = await r.json().catch(() => ({}))
    // Pass the engine's own refusal through. It knows why a delete was denied
    // and says so in a sentence; flattening that to "delete failed" would leave
    // someone retrying a thing that will never work.
    if (!r.ok) return res.status(r.status).json(body)
    return res.status(200).json({ ok: true, name: site.name })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'the Cloud API did not answer in time' : 'could not reach the Cloud API',
      detail,
    })
  }
}
