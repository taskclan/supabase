/**
 * POST /v2/projects/[ref]/advisors/run — the "health" advisor.
 *
 * Distinct from run-lints (splinter security/performance checks): these are
 * infra-health checks. Most of the platform set (log error rates, alert firing)
 * needs Logflare/metrics/alerting that Taskclan Cloud does not run, so we
 * compute the two that are answerable from the app's own database — reachability
 * and connection headroom — and omit the rest. The client filters
 * `advisor_check_unavailable`, so an empty result reads as "no health issues".
 */
import { NextApiRequest, NextApiResponse } from 'next'

import { constructHeaders } from '@/lib/api/apiHelpers'
import { apiWrapper } from '@/lib/api/apiWrapper'
import { executeQuery } from '@/lib/api/self-hosted/query'
import { callerFromRequest } from '@/lib/taskclan/callerContext'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

type Level = 'ERROR' | 'WARN' | 'INFO'
interface HealthLint {
  cache_key: string
  categories: 'HEALTH'[]
  description: string
  detail: string
  facing: 'EXTERNAL'
  level: Level
  name: string
  remediation: string
  title: string
  metadata: { type: 'health' }
}

function healthLint(
  name: string,
  level: Level,
  title: string,
  detail: string,
  remediation: string
): HealthLint {
  return {
    cache_key: `health-${name}`,
    categories: ['HEALTH'],
    description: title,
    detail,
    facing: 'EXTERNAL',
    level,
    name,
    remediation,
    title,
    metadata: { type: 'health' },
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
  const headers = constructHeaders(req.headers)
  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller
  const lints: HealthLint[] = []

  // Reachability — can the app's database answer a trivial probe?
  const reach = await executeQuery<{ ok: number }>({
    query: 'select 1 as ok',
    headers,
    ref,
    caller,
    readOnly: true,
  })

  if (reach.error) {
    lints.push(
      healthLint(
        'db_not_reachable',
        'ERROR',
        'Database not reachable',
        'The database did not respond to a health probe.',
        'Check the database status and this app’s connection settings.'
      )
    )
  } else {
    // Connection headroom — only meaningful when reachable.
    const conn = await executeQuery<{ used: number; max: number }>({
      query:
        "select count(*)::int as used, current_setting('max_connections')::int as max from pg_stat_activity",
      headers,
      ref,
      caller,
      readOnly: true,
    })
    const row = Array.isArray(conn.data) ? conn.data[0] : undefined
    if (row && row.max > 0 && row.used / row.max >= 0.9) {
      lints.push(
        healthLint(
          'db_connection_limit_reached',
          'WARN',
          'Database connection limit nearly reached',
          `${row.used} of ${row.max} connections are in use.`,
          'Close idle connections, or connect through the pooler for serverless workloads.'
        )
      )
    }
  }

  return res.status(200).json({ data: { type: 'project_advisors', attributes: { lints } } })
}
