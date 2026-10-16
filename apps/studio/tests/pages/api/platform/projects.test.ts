/**
 * Every app the caller can reach, one page at a time (Version 2).
 *
 * Studio's useProjectsInfiniteQuery asks this route for
 * `{ projects, pagination }`, and every consumer flattens
 * `pages.flatMap((page) => page.projects)`. The route answered with a bare list
 * whatever was asked, so `page.projects` was undefined and each consumer got an
 * `undefined` project. The command menu destructured it and the New
 * organization page died with "Cannot destructure property 'name' of
 * 'undefined'" (2026-10-09).
 */
import { createMocks } from 'node-mocks-http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../pages/api/platform/projects'

const { listCloudSites, orgs } = vi.hoisted(() => ({
  listCloudSites: vi.fn(),
  orgs: {
    value: [
      { uuid: 'org-a', id: 1, name: 'Personal', slug: 'personal', plan: 'free' },
      { uuid: 'org-b', id: 2, name: 'Team', slug: 'team', plan: 'free' },
    ],
  },
}))

vi.mock('@/lib/taskclan/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/taskclan/client')>()),
  taskclanConfigured: () => true,
  listCloudSites,
  createCloudSite: vi.fn(),
}))
vi.mock('@/lib/taskclan/org', () => ({
  taskclanOrgs: async () => ({ ok: true, data: { orgs: orgs.value, active: orgs.value[0] } }),
  taskclanOrg: async () => ({ ok: true, data: orgs.value[0] }),
}))

const site = (id: string, name: string, createdAt: string) => ({
  id, name, subdomain: name, status: 'live', type: 'service', region: null, createdAt,
})
const SITES: Record<string, unknown[]> = {
  'org-a': [site('s1', 'billing', '2026-08-01T00:00:00Z'), site('s2', 'api', '2026-08-02T00:00:00Z')],
  'org-b': [site('s3', 'website', '2026-09-01T00:00:00Z')],
}

const get = async (query: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const { req, res } = createMocks({
    method: 'GET',
    query,
    headers: { authorization: 'Bearer user-session-token', version: '2', ...headers },
  })
  await handler(req as never, res as never)
  return res
}

beforeEach(() => {
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = 'sk_cloud_' + 'a'.repeat(48)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  listCloudSites.mockReset().mockImplementation(async (caller: { kind: string; org?: string }) => ({
    ok: true,
    data: SITES[caller.kind === 'user' ? (caller.org as string) : 'org-a'] ?? [],
  }))
})

describe('GET /api/platform/projects, Version 2', () => {
  it('answers with a page every consumer can flatten, which the bare list was not', async () => {
    const res = await get()
    expect(res._getStatusCode()).toBe(200)

    const body = res._getJSONData()
    const flattened = [body].flatMap((page: { projects: Array<{ name: string; ref: string }> }) => page.projects)
    expect(flattened).not.toContain(undefined)
    // What the command menu does to each one, and the line that threw.
    expect(() => flattened.map(({ name, ref }) => `${name} (${ref})`)).not.toThrow()
    expect(body.pagination).toEqual({ count: 3, limit: 20, offset: 0 })
  })

  it("lists every organisation's apps, each tagged with its slug", async () => {
    const { projects } = (await get())._getJSONData()

    expect(projects.map((p: { name: string; organization_slug: string }) => `${p.organization_slug}/${p.name}`))
      .toEqual(['personal/api', 'personal/billing', 'team/website'])
    for (const p of projects) expect(p.databases).toEqual([])
  })

  it('pages, sorts and searches on the server, counting the filtered set', async () => {
    const page = (await get({ limit: '1', offset: '1', sort: 'inserted_at_desc' }))._getJSONData()
    expect(page.projects.map((p: { name: string }) => p.name)).toEqual(['api'])
    expect(page.pagination).toEqual({ count: 3, limit: 1, offset: 1 })

    const searched = (await get({ search: 'web' }))._getJSONData()
    expect(searched.projects.map((p: { name: string }) => p.name)).toEqual(['website'])
    expect(searched.pagination.count).toBe(1)
  })

  it('lists a shared key\'s own organisation once, not once per organisation of its minter', async () => {
    const res = await get({}, { authorization: '' })

    expect(res._getStatusCode()).toBe(200)
    expect(listCloudSites).toHaveBeenCalledTimes(1)
    expect(res._getJSONData().pagination.count).toBe(2)
  })

  it('answers 502 when one organisation cannot be listed, rather than a list that is quietly short', async () => {
    listCloudSites.mockImplementation(async (caller: { org?: string }) =>
      caller.org === 'org-b' ? { ok: false, reason: 'http_error', detail: 'engine 500' } : { ok: true, data: SITES['org-a'] }
    )
    const res = await get()
    expect(res._getStatusCode()).toBe(502)
    expect(res._getJSONData().error.message).toContain('engine 500')
  })
})

describe('GET /api/platform/projects, without a version', () => {
  it('keeps the bare list for anything that still asks for it', async () => {
    const body = (await get({}, { version: '' }))._getJSONData()
    expect(Array.isArray(body)).toBe(true)
  })
})
