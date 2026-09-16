/**
 * GET /api/taskclan/{ref}/connection-string — the app's Postgres connection.
 *
 * The Connect panel needs a real, copyable connection string. Studio's own
 * builder derives it from Supabase pooler/supavisor config that self-hosted
 * Taskclan does not have, so those tabs come out blank. This returns the app's
 * actual scoped connection — the same per-app pooler role the Table/SQL editors
 * use — so the panel can show a string that works.
 *
 * This DOES return the connection string, password included, to the browser
 * (behind the console's access gate). That is a deliberate reveal: the console
 * otherwise keeps the connection server-side, but a Connect panel that cannot
 * show the string is not a Connect panel. Only expose it to a caller that has
 * already passed the gate.
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

  if (!perAppCredentialsEnabled()) {
    return res.status(501).json({ error: 'per-app credentials are not enabled' })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })

  const result = await credentialForRef(ref, resolved.caller)
  if (!result.ok) {
    // not_configured is the ordinary "this app has no database" case; surface it
    // so the panel can say so rather than showing a broken string.
    return res.status(200).json({ configured: false, reason: result.reason })
  }

  const connectionString = result.connectionString
  // Derive the pooler variants from the one connection we hold. The credential
  // is a transaction-pooler URL (port 6543); session mode is the same host on
  // 5432. There is no separate direct host for a pooled scoped role, so the
  // session URL is the closest honest "direct".
  const transaction = connectionString
  const session = connectionString.replace(':6543/', ':5432/')

  return res.status(200).json({
    configured: true,
    transaction,
    session,
    // What the parser needs to render the parameter view without re-parsing the
    // secret on the client more than once.
    parts: safeParts(connectionString),
  })
}

function safeParts(cs: string): {
  host: string
  port: string
  user: string
  database: string
} | null {
  try {
    const u = new URL(cs)
    return {
      host: u.hostname,
      port: u.port || '6543',
      user: decodeURIComponent(u.username),
      database: u.pathname.replace(/^\//, '') || 'postgres',
    }
  } catch {
    return null
  }
}
