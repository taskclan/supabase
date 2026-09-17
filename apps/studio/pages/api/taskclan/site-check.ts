/**
 * GET /api/taskclan/site-check?name=... — is this app name's subdomain free?
 *
 * The create form previously slugified the name in the browser and showed the
 * result as a preview. That preview was honest about the *shape* of the
 * subdomain and silent about the only thing that can actually fail: somebody
 * else already having it. The engine owns both the slug rules and the
 * uniqueness check, so this asks it rather than reimplementing either.
 *
 * Answers are per-caller because taken-ness is global but reserved names and
 * the host suffix come from the engine's own configuration; going out under the
 * caller's token also keeps this consistent with every other proxy here.
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

  const raw = req.query.name
  const name = (Array.isArray(raw) ? raw[0] : (raw ?? '')).trim()
  // The engine answers an empty name with a well-formed "not valid" rather than
  // an error, but there is no reason to spend a round trip discovering that.
  if (name.length === 0) {
    return res.status(200).json({ valid: false, available: false, subdomain: '', host: '' })
  }

  try {
    const r = await fetch(
      `${cloud.url}/api/cloud/v1/sites/check?name=${encodeURIComponent(name)}`,
      {
        headers: authHeadersFor(resolved.caller),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    const body = await r.json().catch(() => ({}))
    return res.status(r.status).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
