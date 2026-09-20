/**
 * POST /api/taskclan/auth/magic-link — proxy a sign-in-link request to the
 * engine, which mints the one-time link and sends it via Resend, branded for
 * Taskclan rather than the shared Supabase project's Nani-branded default.
 *
 * Server-side so the browser never talks to the engine cross-origin, the same
 * way every other Cloud call is made from here. Unauthenticated by necessity —
 * the caller has no session yet — and the engine answers uniformly (always ok
 * for a syntactically valid address, so it is not an account-existence oracle),
 * so this forwards the upstream status without interpreting it.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl } from '@/lib/taskclan/client'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const base = cloudBaseUrl()
  if (!base.ok) return res.status(500).json({ error: 'cloud is not configured' })

  const body = (req.body ?? {}) as { email?: unknown; redirectTo?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const redirectTo = typeof body.redirectTo === 'string' ? body.redirectTo : undefined
  if (!email) return res.status(400).json({ error: 'email is required' })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const upstream = await fetch(`${base.url}/api/cloud/v1/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo }),
      signal: controller.signal,
    })
    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
    return res.send(text)
  } catch {
    return res.status(502).json({ error: 'could not reach the sign-in service' })
  } finally {
    clearTimeout(timeout)
  }
}
