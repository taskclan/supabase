/**
 * GET  /api/taskclan/{ref}/deploy-mode — the app's current deploy mode.
 * POST /api/taskclan/{ref}/deploy-mode — switch it between auto and manual.
 *
 * Every Cloud app is `manual` by default: a merge to the default branch opens an
 * intent and waits. That is the right default for a platform running someone
 * else's money, but it is only defensible if seeing and flipping it is one
 * visible control (the Deployment settings page) rather than an API call
 * somebody has to be told about. GET backs the toggle's initial state so it
 * reflects the real mode instead of assuming one.
 *
 * Same reason as ./deployments.ts for being a server route: the Cloud API key
 * deploys every app in the org and must not reach a page.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'

const TIMEOUT_MS = 15000

type Mode = 'auto' | 'manual'
const asMode = (v: unknown): Mode => (v === 'auto' ? 'auto' : 'manual')

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  // Validate the write payload up front, before any Cloud call. Rejected rather
  // than defaulted, matching the engine's own handler: silently defaulting an
  // unrecognised value would turn a typo into a live app that ships on every
  // merge.
  let mode: Mode | null = null
  if (req.method === 'POST') {
    const m = (req.body as { mode?: unknown })?.mode
    if (m !== 'auto' && m !== 'manual') {
      return res.status(400).json({ error: "mode must be 'auto' or 'manual'" })
    }
    mode = m
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const lookup = await siteForCaller(ref, caller)
    // Distinguish "no such app for this caller" from "could not reach Cloud":
    // answering 404 for an outage tells someone their app has vanished.
    if (!lookup.ok) return res.status(502).json({ error: lookup.detail })
    const site = lookup.data
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })

    // Read: the mode already rides along on the resolved site (the engine's
    // sites list carries deployMode), so this needs no second Cloud call.
    if (req.method === 'GET') {
      return res.status(200).json({ mode: asMode(site.deployMode) })
    }

    const r = await fetch(`${cloud.url}/api/cloud/v1/sites/${site.id}/deploy-mode`, {
      method: 'POST',
      headers: {
        ...authHeadersFor(caller),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const out = await r.json().catch(() => ({}))
    return res.status(r.status).json(out)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return res.status(502).json({ error: 'could not reach the Cloud API', detail })
  }
}
