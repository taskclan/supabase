/**
 * The org's projects endpoint — the one the Projects grid reads.
 *
 * These tests exist because of a crash that only ever reached people WITHOUT a
 * Cloud API key. `OrganizationProjectsResponse_Output` marks `databases`
 * required, and ProjectCard trusts that: getComputeSize() calls
 * `project.databases.find(...)` with no optional chaining. The Cloud branch
 * conforms; the stub branch returned upstream's DEFAULT_PROJECT verbatim, which
 * has no `databases` — so a fresh checkout rendered an error boundary instead
 * of a grid.
 *
 * The guard is on the RESPONSE rather than on getComputeSize, deliberately.
 * Making getComputeSize tolerate a missing field would silence this and also
 * silence a genuinely malformed payload from Cloud, which is the case you want
 * to hear about.
 */
import { createMocks } from 'node-mocks-http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../pages/api/platform/organizations/[slug]/projects'

const configured = vi.hoisted(() => ({ value: false }))

vi.mock('@/lib/taskclan/client', () => ({
  taskclanConfigured: () => configured.value,
  listCloudSites: vi.fn(),
}))

const get = async (query: Record<string, string> = {}) => {
  const { req, res } = createMocks({ method: 'GET', query: { slug: 'default-org-slug', ...query } })
  await handler(req as never, res as never)
  return res
}

/** What ProjectCard does to every row, reduced to the part that threw. */
const computeSizeOf = (project: { databases: { identifier: string }[]; ref: string }) =>
  project.databases.find((db) => db.identifier === project.ref)

describe('GET /api/platform/organizations/[slug]/projects — unconfigured', () => {
  beforeEach(() => {
    configured.value = false
  })

  it('marks the payload as the stub rather than passing it off as real', async () => {
    const res = await get()
    expect(res._getStatusCode()).toBe(200)
    expect(res.getHeader('x-taskclan-source')).toBe('stub')
  })

  it('returns projects the grid can render without throwing', async () => {
    const res = await get()
    const { projects } = res._getJSONData()

    expect(projects).toHaveLength(1)
    for (const project of projects) {
      expect(Array.isArray(project.databases)).toBe(true)
      expect(() => computeSizeOf(project)).not.toThrow()
    }
  })

  it('reports no compute size rather than inventing one', async () => {
    const res = await get()
    const [project] = res._getJSONData().projects
    // Empty, not fabricated: `infra_compute_size` is a primary database's size,
    // and an unconfigured console has no database to report one for.
    expect(project.databases).toEqual([])
    expect(computeSizeOf(project)).toBeUndefined()
  })

  it('counts the single stub row so the grid stops paging', async () => {
    const res = await get({ limit: '20', offset: '0' })
    expect(res._getJSONData().pagination).toMatchObject({ count: 1, limit: 20, offset: 0 })
  })
})
