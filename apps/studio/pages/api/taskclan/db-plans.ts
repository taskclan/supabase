/**
 * GET /api/taskclan/db-plans — the managed-database providers and tiers, for the
 * new-project form's "dedicated database" options.
 *
 * The engine surfaces these (env-tunable) globals on a site's databases GET,
 * but the new-project form has no site yet. They are the same for every site in
 * the org, so this reads them from the first existing app and returns just the
 * catalogue (no per-site database rows). If the org has no apps yet, it returns
 * empty lists — the form then simply offers no dedicated-database option, which
 * is correct for a brand-new org.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { listCloudSites, taskclanConfig } from '@/lib/taskclan/client'
import { withCloudSession } from '@/lib/taskclan/session'

const TIMEOUT_MS = 15000

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const cfg = taskclanConfig()
  if (!cfg.ok) return res.status(501).json({ error: 'not_configured', detail: cfg.reason })

  const sites = await listCloudSites()
  if (!sites.ok) {
    return res.status(502).json({ error: 'could not reach the Cloud API', detail: sites.detail })
  }
  const first = sites.data[0]
  if (!first) {
    return res.status(200).json({
      managedPostgresProviders: [],
      supabasePlans: [],
      plans: [],
      supabaseOAuth: false,
    })
  }

  try {
    const r = await fetch(`${cfg.config.url}/api/cloud/v1/sites/${first.id}/databases`, {
      headers: { authorization: `Bearer ${cfg.config.key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
    return res.status(r.status).json({
      managedPostgresProviders: body.managedPostgresProviders ?? [],
      supabasePlans: body.supabasePlans ?? [],
      plans: body.plans ?? [],
      redisPlans: body.redisPlans ?? [],
      supabaseOAuth: body.supabaseOAuth ?? false,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? 'plan lookup timed out' : 'could not reach the Cloud API', detail })
  }
}

export default withCloudSession(handler)
