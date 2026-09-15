/**
 * GET /api/taskclan/connect-info — the shared, non-secret bits the Connect
 * panel needs beyond the per-app connection string.
 *
 * These values are the SAME for every Taskclan app, so this is deliberately
 * ref-independent:
 *
 *  - apiUrl / anonKey / publishableKey: the shared Supabase project's REST
 *    endpoint and its ANON key. This is the real connection method the apps use
 *    through supabase-js (nani, the web clients), and the anon key is already
 *    public — it ships in every app's client bundle (EXPO_PUBLIC_/VITE_/
 *    NEXT_PUBLIC_). Surfacing it in the gated console is not a new exposure.
 *    The service_role key is a real secret and is NEVER returned here.
 *
 *  - mcpUrl: the Taskclan Cloud MCP (the org control-plane MCP on the engine).
 *
 * IMPORTANT nuance the UI must convey: the anon key maps to the shared `anon`
 * role and is governed by RLS on the shared database — it is NOT per-app
 * isolated. The per-app isolation boundary is the connection string (a scoped
 * Postgres role). REST-via-anon-key and per-app isolation are different things.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const apiUrl = process.env.TASKCLAN_SUPABASE_URL?.trim() || null
  const anonKey = process.env.TASKCLAN_SUPABASE_ANON_KEY?.trim() || null
  // The shared project has no `sb_publishable_...` key today; only the legacy
  // anon JWT. Null is honest — the framework snippets fall back to the anon key.
  const publishableKey = process.env.TASKCLAN_SUPABASE_PUBLISHABLE_KEY?.trim() || null

  const cloudUrl = process.env.TASKCLAN_CLOUD_URL?.trim().replace(/\/+$/, '')
  const mcpUrl = cloudUrl ? `${cloudUrl}/api/cloud/mcp` : null

  return res.status(200).json({ apiUrl, anonKey, publishableKey, mcpUrl })
}
