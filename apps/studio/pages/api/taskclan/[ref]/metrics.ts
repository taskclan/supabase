/**
 * GET /api/taskclan/{ref}/metrics?range=1h|24h|7d|30d — the container's own
 * request telemetry, slimmed to what the home activity panel draws.
 *
 * A Taskclan app is a Cloudflare container, so it has real request counts, a
 * success rate, latency and a per-bucket series — the honest version of the
 * "Total Requests / Success Rate" panel, built from the app itself rather than
 * from Supabase's five managed services, which a container does not have.
 *
 * The engine's /metrics response is large (latency series, slow queries, CPU
 * percentiles, alert rules); this returns only the activity fields, so the home
 * page moves a few hundred bytes instead of tens of kilobytes. The Cloud API
 * key stays on the server, as with every taskclan route.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { taskclanConfig } from '@/lib/taskclan/client'
import { findSiteByRef, type CloudSite } from '@/lib/taskclan/projects'

const TIMEOUT_MS = 20000
const RANGES = new Set(['1h', '24h', '7d', '30d'])

interface EngineMetrics {
  metrics?: {
    configured?: boolean
    totals?: { requests?: number; errors?: number }
    status?: { success?: number; clientDisconnected?: number }
    series?: Array<{ t: string; requests?: number; errors?: number; success?: number }>
  }
  summary?: { requestsPerMinute?: number; errorRatePct?: number; deltas?: { requests?: number } }
  availability?: { uptimePct?: number }
  container?: {
    allocation?: { vcpu?: number; memory?: string; memoryMib?: number; disk?: string }
  }
  cpu?: { utilizationPct?: number }
  instances?: { active?: number; healthy?: number; starting?: number; failed?: number }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })
  const range = typeof req.query.range === 'string' && RANGES.has(req.query.range)
    ? req.query.range
    : '24h'

  const cfg = taskclanConfig()
  if (!cfg.ok) return res.status(501).json({ error: 'not_configured', detail: cfg.reason })

  const auth = { authorization: `Bearer ${cfg.config.key}`, accept: 'application/json' }

  try {
    const listRes = await fetch(`${cfg.config.url}/api/cloud/v1/sites`, {
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!listRes.ok) return res.status(502).json({ error: 'could not list Taskclan apps' })
    const listed = (await listRes.json()) as { sites?: CloudSite[] }
    const site = findSiteByRef(Array.isArray(listed.sites) ? listed.sites : [], ref)
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })

    const mRes = await fetch(`${cfg.config.url}/api/cloud/v1/sites/${site.id}/metrics?range=${range}`, {
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await mRes.json().catch(() => ({}))) as EngineMetrics
    if (!mRes.ok) return res.status(mRes.status).json(body)

    const m = body.metrics ?? {}
    const totals = m.totals ?? {}
    const status = m.status ?? {}
    const requests = totals.requests ?? 0
    const errors = totals.errors ?? 0
    // Success rate is over what the container actually answered. A client that
    // hung up (clientDisconnected) is not an error the app caused, so it is
    // reported separately rather than folded into either bucket.
    const answered = (status.success ?? 0) + errors
    const successRate = answered > 0 ? (100 * (status.success ?? 0)) / answered : null

    const alloc = body.container?.allocation ?? {}
    const inst = body.instances ?? {}
    return res.status(200).json({
      configured: m.configured ?? false,
      range,
      // The container the app runs on — the honest per-app equivalent of
      // Supabase's Primary Database card, which describes a database this app
      // does not own alone.
      instance: {
        region: (site as { region?: string }).region || 'auto',
        vcpu: alloc.vcpu ?? null,
        memoryMib: alloc.memoryMib ?? null,
        disk: alloc.disk ?? null,
        cpuPct: body.cpu?.utilizationPct ?? null,
        active: inst.active ?? 0,
        healthy: inst.healthy ?? 0,
      },
      requests,
      errors,
      disconnected: status.clientDisconnected ?? 0,
      successRatePct: successRate,
      requestsPerMinute: body.summary?.requestsPerMinute ?? null,
      requestsDeltaPct: body.summary?.deltas?.requests ?? null,
      uptimePct: body.availability?.uptimePct ?? null,
      series: (m.series ?? []).map((p) => ({
        t: p.t,
        requests: p.requests ?? 0,
        errors: p.errors ?? 0,
      })),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'the Cloud API did not answer in time' : 'could not reach the Cloud API',
      detail,
    })
  }
}
