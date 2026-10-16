/**
 * GET /api/taskclan/{ref}/db-status — does this app have a managed database?
 *
 * The database screens (Table editor, SQL editor, Database) connect through a
 * per-app Postgres role. Most Taskclan apps store nothing in the shared
 * database and have no such role, so those screens used to throw a generic
 * "API error happened while trying to communicate with the server" — which
 * reads as an outage rather than the truth: the app simply has no database.
 *
 * This is the cheap check the console uses to render an honest "no database"
 * state instead. It resolves the credential but never returns it — only whether
 * one exists — so it is safe to call from the browser.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { credentialForRef, perAppCredentialsEnabled } from '@/lib/taskclan/db-credential'
import { callerFromRequest } from '@/lib/taskclan/callerContext'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  // Plain self-hosted Studio (no Cloud wiring) uses one shared connection, so a
  // database is always "configured" there — the per-app concept does not apply.
  if (!perAppCredentialsEnabled()) {
    return res.status(200).json({ configured: true })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const result = await credentialForRef(ref, resolved.caller)
  if (result.ok) return res.status(200).json({ configured: true })

  // not_configured is the ordinary "this app has no database" case; the others
  // (no_such_app, unauthorized, network_error) are surfaced so the panel can
  // distinguish "no database" from "could not check".
  return res.status(200).json({ configured: false, reason: result.reason, detail: result.detail })
}
