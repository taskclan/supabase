/**
 * POST /api/taskclan/org/transfer { slug, toUserId } — hand workspace ownership
 * to another member, as the signed-in owner.
 *
 * The engine's transfer endpoint is keyed by the org's UUID (`getOrg` looks up
 * by id, never slug), and the browser only ever holds the slug. So this resolves
 * the caller's org by slug to its uuid first — `orgForSlug` is caller-scoped, so
 * it can only name an org the signed-in person already belongs to — then forwards
 * to `/api/cloud/v1/orgs/{uuid}/transfer`. The engine does the owner check and the
 * atomic promote/demote; this relays its answer (and field-level errors) unchanged.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'
import { orgForSlug } from '@/lib/taskclan/org'

const TIMEOUT_MS = 20000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  // Transferring ownership is a person's act on their own workspace; the shared
  // key has no user behind it to be or become an owner.
  if (resolved.caller.kind === 'shared') {
    return res.status(403).json({ error: 'Sign in to transfer ownership.' })
  }

  const body = (req.body ?? {}) as { slug?: unknown; toUserId?: unknown }
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const toUserId = typeof body.toUserId === 'string' ? body.toUserId.trim() : ''
  if (!slug) return res.status(400).json({ error: 'slug is required' })
  if (!toUserId) return res.status(400).json({ error: 'toUserId is required' })

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  const org = await orgForSlug(slug, resolved.caller)
  if (!org.ok) {
    return res.status(502).json({ error: 'could not reach the Cloud API', detail: org.detail })
  }
  if (!org.data) return res.status(404).json({ error: 'workspace not found' })

  try {
    const r = await fetch(
      `${cloud.url}/api/cloud/v1/orgs/${encodeURIComponent(org.data.uuid)}/transfer`,
      {
        method: 'POST',
        headers: { ...authHeadersFor(resolved.caller), 'content-type': 'application/json' },
        body: JSON.stringify({ toUserId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
    const payload = await r.json().catch(() => ({}))
    return res.status(r.status).json(payload)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
