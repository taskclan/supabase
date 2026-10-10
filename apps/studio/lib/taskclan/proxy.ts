/**
 * Authenticated pass-through to a Cloud engine endpoint, as the signed-in user.
 *
 * The console's `/api/platform/*` routes call the engine server-side so the
 * browser never holds a cross-origin token or the shared key. For features that
 * are purely the user's own actions on their workspace (domains, transfers),
 * the simplest correct bridge is to forward the caller's bearer token and name
 * the workspace with `x-taskclan-org`, then relay the engine's status and body
 * unchanged — the engine already does auth, org scoping and RBAC.
 *
 * The engine path is fixed by the calling route, never taken from user input,
 * so this cannot be turned into an open proxy. Gated by TASKCLAN_MULTI_TENANT.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { bearerFromHeader, taskclanConfig, taskclanMultiTenant } from './client'

const TIMEOUT_MS = 15000

/** The route param Next adds for /org/[slug]; never forwarded as a query arg. */
function slugOf(req: NextApiRequest): string {
  const s = req.query.slug
  return (Array.isArray(s) ? s[0] : s)?.trim() ?? ''
}

/** The query string to forward: everything except the [slug] route param. */
function forwardedQuery(req: NextApiRequest): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'slug') continue
    for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) params.append(k, String(one))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export interface CloudProxyOptions {
  /** The engine endpoint, fixed by the route (e.g. '/api/cloud/v1/domains/search'). */
  enginePath: string
  /** HTTP methods this route allows. */
  methods: Array<'GET' | 'POST' | 'PUT' | 'DELETE'>
  /** Append the forwarded query string (GET reads). Default true for GET, false otherwise. */
  forwardQuery?: boolean
}

/**
 * Forward one request to the engine as the signed-in user and relay the result.
 * Returns the engine's own JSON (including field-level errors like `missing`),
 * so the data hooks see exactly what the engine said.
 */
export async function cloudProxy(req: NextApiRequest, res: NextApiResponse, opts: CloudProxyOptions): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE'
  if (!opts.methods.includes(method)) {
    res.setHeader('Allow', opts.methods)
    res.status(405).json({ error: `Method ${method} Not Allowed` })
    return
  }
  if (!taskclanMultiTenant()) {
    res.status(501).json({ error: 'Multi-tenant mode is off (TASKCLAN_MULTI_TENANT).' })
    return
  }
  const token = bearerFromHeader(req.headers.authorization)
  if (!token) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  const slug = slugOf(req)
  if (!slug) {
    res.status(400).json({ error: 'workspace slug is required' })
    return
  }
  const cfg = taskclanConfig()
  if (!cfg.ok) {
    res.status(501).json({ error: cfg.reason })
    return
  }

  const forwardQuery = opts.forwardQuery ?? method === 'GET'
  const url = `${cfg.config.url}${opts.enginePath}${forwardQuery ? forwardedQuery(req) : ''}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const engineRes = await fetch(url, {
      method,
      headers: {
        authorization: /^bearer /i.test(token) ? token : `Bearer ${token}`,
        accept: 'application/json',
        'x-taskclan-org': slug,
        ...(method === 'GET' || method === 'DELETE' ? {} : { 'content-type': 'application/json' }),
      },
      ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(req.body ?? {}) }),
      signal: controller.signal,
    })
    const text = await engineRes.text()
    res.status(engineRes.status)
    try {
      res.json(JSON.parse(text))
    } catch {
      res.send(text)
    }
  } catch (e) {
    res.status(502).json({ error: `Taskclan Cloud did not answer: ${e instanceof Error ? e.message : String(e)}` })
  } finally {
    clearTimeout(timer)
  }
}
