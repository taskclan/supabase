/**
 * PATCH /platform/organizations/{slug} — rename the workspace.
 *
 * Studio's org General settings PATCHes this Supabase-platform path. Self-hosted
 * there was no handler for the base {slug} route (only .../members, .../projects,
 * …), so the rename hit a 404 and silently did nothing — the workspace was stuck
 * on its default name. This forwards it to the engine (PATCH /api/cloud/v1/orgs),
 * which renames the caller's active org, owner/admin only. The Cloud key stays on
 * the server; the caller is forwarded under their own token.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'

const TIMEOUT_MS = 15000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH'])
    return res
      .status(405)
      .json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
  }

  const slug = typeof req.query.slug === 'string' ? req.query.slug : ''
  const name = (req.body as { name?: unknown })?.name
  if (typeof name !== 'string' || name.trim().length < 2) {
    return res
      .status(400)
      .json({ data: null, error: { message: 'name must be at least 2 characters' } })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ data: null, error: { message: cloud.reason } })

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/orgs`, {
      method: 'PATCH',
      headers: { ...authHeadersFor(caller), 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await r.json().catch(() => ({}))) as {
      org?: { id?: string; name?: string }
      error?: string
    }
    if (!r.ok) {
      return res
        .status(r.status)
        .json({ data: null, error: { message: body.error ?? `Taskclan Cloud answered ${r.status}` } })
    }
    // Shape the response the way Studio's org-update mutation expects: onSuccess
    // reads data.slug, and refreshes its caches from the name it sent.
    return res.status(200).json({ id: body.org?.id, slug, name: body.org?.name ?? name.trim() })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      data: null,
      error: {
        message: timedOut
          ? 'Taskclan Cloud did not answer in time'
          : `could not reach Taskclan Cloud: ${detail}`,
      },
    })
  }
}
