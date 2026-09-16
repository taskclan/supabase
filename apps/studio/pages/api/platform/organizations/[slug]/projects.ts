/**
 * GET /platform/organizations/{slug}/projects — the org's apps, paginated.
 *
 * This is the endpoint the Projects grid actually reads. `/platform/projects`
 * was already answering from Cloud, which is why the project picker listed real
 * apps — but the grid on `/org/{slug}` uses this one, and it did not exist. The
 * request fell through to the self-hosted default and the page showed a single
 * "Default Project" card while twenty-two real apps sat behind the other
 * endpoint. Two sources of truth, one of them wrong, and only the less-visible
 * one had been fixed.
 *
 * Same three outcomes as ./../../projects/index.ts, for the same reasons: the
 * stub when Cloud is not configured, a 502 when it is configured and failing,
 * and the real list otherwise. Never the stub while real apps exist and are
 * merely unreachable.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { DEFAULT_PROJECT } from '@/lib/constants/api'
import { listCloudSites, taskclanConfigured } from '@/lib/taskclan/client'
import { callerFromRequest } from '@/lib/taskclan/callerContext'
import { taskclanOrg } from '@/lib/taskclan/org'
import { toStudioProjects, type StudioProject } from '@/lib/taskclan/projects'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res
      .status(405)
      .json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
  }
  return handleGet(req, res)
}

const num = (v: unknown, fallback: number): number => {
  const n = Number(Array.isArray(v) ? v[0] : v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const str = (v: unknown): string => (Array.isArray(v) ? (v[0] ?? '') : typeof v === 'string' ? v : '')

/**
 * Sort, search and status filtering happen here rather than in the browser.
 *
 * The grid is an infinite query: it asks for a page at a time and appends. If
 * the server ignored `search` and `sort`, filtering would only ever apply to
 * the pages already fetched — so a search would appear to work, and silently
 * miss every app the reader had not scrolled to yet.
 */
function applyQuery(
  projects: StudioProject[],
  { search, statuses, sort }: { search: string; statuses: string[]; sort: string }
): StudioProject[] {
  let out = projects
  if (search) {
    const needle = search.toLowerCase()
    out = out.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.ref.toLowerCase().includes(needle)
    )
  }
  if (statuses.length) {
    const wanted = new Set(statuses)
    out = out.filter((p) => wanted.has(p.status))
  }
  const byName = (a: StudioProject, b: StudioProject) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const byInserted = (a: StudioProject, b: StudioProject) =>
    Date.parse(a.inserted_at) - Date.parse(b.inserted_at)

  // Copy before sorting: the array came from the mapper and callers should not
  // inherit an ordering decided here.
  const sorted = [...out]
  switch (sort) {
    case 'name_desc':
      return sorted.sort((a, b) => byName(b, a))
    case 'inserted_at_asc':
      return sorted.sort(byInserted)
    case 'inserted_at_desc':
      return sorted.sort((a, b) => byInserted(b, a))
    case 'name_asc':
    default:
      return sorted.sort(byName)
  }
}

const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  const limit = num(req.query.limit, 20)
  const offset = num(req.query.offset, 0)
  const sort = str(req.query.sort) || 'name_asc'
  const search = str(req.query.search).trim()
  const statuses = str(req.query.statuses)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    // `databases: []` for exactly the reason the Cloud branch below adds it —
    // see the comment there. DEFAULT_PROJECT is upstream's constant and carries
    // no `databases`, so the stub violated the same required field, and the
    // grid died on the error boundary rather than rendering one placeholder
    // card. The Cloud path was fixed when it was written; this one was missed,
    // which hid it: the crash only reaches someone with no Cloud key — a fresh
    // checkout, where "the console is broken" is the worst first impression.
    return res.status(200).json({
      projects: [{ ...DEFAULT_PROJECT, databases: [] }],
      pagination: { count: 1, limit, offset },
    })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller

  const [org, sites] = await Promise.all([taskclanOrg(caller), listCloudSites(caller)])
  if (!org.ok) {
    console.error('[taskclan] resolving the org failed: %s — %s', org.reason, org.detail)
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }
  if (!sites.ok) {
    console.error('[taskclan] listing apps failed: %s — %s', sites.reason, sites.detail)
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${sites.detail}` } })
  }

  const all = applyQuery(toStudioProjects(sites.data, org.data.id), { search, statuses, sort })

  // `databases` is required, not optional decoration: ProjectCard calls
  // getComputeSize(), which does `project.databases.find(...)` with no optional
  // chaining, so a project without it throws and takes the whole grid down with
  // an error boundary. Every card, not just one.
  //
  // Empty rather than invented. That field is the primary DATABASE's compute
  // size; Cloud's site payload carries a CONTAINER instance type (lite, basic,
  // standard-1), which is a different quantity. Putting one in the other's slot
  // would render a badge that reads plausibly and means something else. With an
  // empty list the badge is simply absent, which is true.
  const projects = all.map((p) => ({ ...p, databases: [] }))

  // `count` is the size of the FILTERED set, not the page and not the org's
  // total. The grid stops paging when it has seen `count` rows, so a total
  // that ignores the filter makes it ask forever for pages that are empty.
  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json({
    projects: projects.slice(offset, offset + limit),
    pagination: { count: all.length, limit, offset },
  })
}
