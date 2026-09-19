/**
 * POST /api/taskclan/session — exchange the caller's Supabase login for a
 * per-org Cloud session (multi-tenant signup, P1).
 *
 * The console SPA sends the user's Supabase access token exactly as it does for
 * every other console API call (`Authorization: Bearer <jwt>`). We forward it to
 * the engine's `/api/cloud/v1/auth/web-session`, which verifies the user,
 * ensures their org, and mints an org-scoped `sk_cloud` key. We seal that key
 * into an httpOnly cookie (see lib/taskclan/session.ts) and return ONLY the
 * non-secret org identity — the key never reaches the browser. P2 makes the
 * engine proxy read this cookie so the whole console scopes to the user's org.
 *
 * DELETE clears the Cloud session cookie (the Supabase sign-out is separate).
 *
 * Dark until the engine's CLOUD_WEB_SIGNUP_ENABLED is on: while off the engine
 * returns 404 and we pass it straight through, so this surface stays inert.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { setCloudSessionCookie, clearCloudSessionCookie } from '@/lib/taskclan/session'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'DELETE') {
    clearCloudSessionCookie(res)
    return res.status(200).json({ ok: true })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const token = req.headers.authorization?.replace(/bearer /i, '').trim()
  if (!token) return res.status(401).json({ error: 'missing access token' })

  const cloudUrl = process.env.TASKCLAN_CLOUD_URL?.trim().replace(/\/+$/, '')
  if (!cloudUrl) return res.status(500).json({ error: 'TASKCLAN_CLOUD_URL is not configured' })

  let engineRes: Response
  try {
    engineRes = await fetch(`${cloudUrl}/api/cloud/v1/auth/web-session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    })
  } catch {
    return res.status(502).json({ error: 'could not reach the Cloud API' })
  }

  // Pass the dark flag through honestly rather than inventing a session.
  if (engineRes.status === 404) return res.status(404).json({ error: 'signup is not enabled' })

  const body = (await engineRes.json().catch(() => ({}))) as {
    access_token?: string
    org_id?: string
    org_name?: string
    error?: string
  }
  if (!engineRes.ok || !body.access_token || !body.org_id) {
    const status = engineRes.status === 401 ? 401 : 502
    return res.status(status).json({ error: body.error || 'session exchange failed' })
  }

  const sealed = setCloudSessionCookie(res, {
    key: body.access_token,
    orgId: body.org_id,
    orgName: body.org_name,
  })
  if (!sealed) return res.status(500).json({ error: 'TASKCLAN_SESSION_SECRET is not configured' })

  // Only the non-secret org identity leaves the server; the key stays in the cookie.
  return res.status(200).json({ ok: true, org_id: body.org_id, org_name: body.org_name })
}
