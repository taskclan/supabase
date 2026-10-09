/**
 * One page of projects, in the shape Studio's paginated project queries read:
 * `{ projects, pagination: { count, limit, offset } }`.
 *
 * Shared by the two routes that answer it: the org's apps
 * (/platform/organizations/{slug}/projects) and every app the caller can reach
 * (/platform/projects, when asked for Version 2). Every consumer of
 * useProjectsInfiniteQuery flattens `pages.flatMap((page) => page.projects)`,
 * so a route that answers with a bare list gives each of them an `undefined`
 * project. The command menu then threw "Cannot destructure property 'name' of
 * 'undefined'" over the New organization page.
 */
import type { StudioProject } from './projects'

export interface ProjectsQuery {
  limit: number
  offset: number
  sort: string
  search: string
  statuses: string[]
}

const num = (v: unknown, fallback: number): number => {
  const n = Number(Array.isArray(v) ? v[0] : v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const str = (v: unknown): string => (Array.isArray(v) ? (v[0] ?? '') : typeof v === 'string' ? v : '')

/** The paging, sort and filters a request asked for, with Studio's defaults. */
export function readProjectsQuery(query: Record<string, unknown>): ProjectsQuery {
  return {
    limit: num(query.limit, 20),
    offset: num(query.offset, 0),
    sort: str(query.sort) || 'name_asc',
    search: str(query.search).trim(),
    statuses: str(query.statuses)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

/**
 * Sort, search and status filtering happen here rather than in the browser.
 *
 * The grid is an infinite query: it asks for a page at a time and appends. If
 * the server ignored `search` and `sort`, filtering would only ever apply to
 * the pages already fetched — so a search would appear to work, and silently
 * miss every app the reader had not scrolled to yet.
 */
export function applyProjectsQuery<P extends StudioProject>(
  projects: P[],
  { search, statuses, sort }: Pick<ProjectsQuery, 'search' | 'statuses' | 'sort'>
): P[] {
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

/**
 * The requested page of an already filtered and sorted list.
 *
 * `databases` is required, not optional decoration: ProjectCard calls
 * getComputeSize(), which does `project.databases.find(...)` with no optional
 * chaining, so a project without it throws and takes the whole grid down with
 * an error boundary. Every card, not just one.
 *
 * Empty rather than invented. That field is the primary DATABASE's compute
 * size; Cloud's site payload carries a CONTAINER instance type (lite, basic,
 * standard-1), which is a different quantity. Putting one in the other's slot
 * would render a badge that reads plausibly and means something else. With an
 * empty list the badge is simply absent, which is true.
 *
 * `count` is the size of the FILTERED set, not the page and not the total. The
 * grid stops paging when it has seen `count` rows, so a total that ignores the
 * filter makes it ask forever for pages that are empty.
 */
export function projectsPage<P extends StudioProject>(all: P[], { limit, offset }: Pick<ProjectsQuery, 'limit' | 'offset'>) {
  return {
    projects: all.slice(offset, offset + limit).map((p) => ({ ...p, databases: [] as never[] })),
    pagination: { count: all.length, limit, offset },
  }
}
