import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listUserSites } from './client'
import { numericIdFor } from './projects'
import { findUserOrg, orgSlug, userOrgs } from './org'

/**
 * Multi-tenant org listing: the console must show the SIGNED-IN USER's orgs,
 * each with the right slug, numeric id and role. A wrong answer here doesn't
 * throw — it shows the wrong workspace, or someone else's.
 */

const KEYS = ['TASKCLAN_CLOUD_URL', 'TASKCLAN_CLOUD_API_KEY', 'TASKCLAN_MULTI_TENANT'] as const
let saved: Record<string, string | undefined> = {}
const GOOD_KEY = 'sk_cloud_' + 'a'.repeat(48)

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = GOOD_KEY
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
})

describe('orgSlug', () => {
  it('prefers Cloud\'s real slug and only derives one when missing', () => {
    expect(orgSlug({ slug: 'aiya', name: 'Aiya' })).toBe('aiya')
    expect(orgSlug({ slug: '', name: 'AIYA Logistics!' })).toBe('aiya-logistics')
    expect(orgSlug({ slug: '', name: '—' })).toBe('taskclan')
  })
})

describe('userOrgs', () => {
  const stubFetch = (body: unknown, status = 200) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        // The user's own token is forwarded, never the shared key.
        const auth = String((init?.headers as Record<string, string>)?.authorization ?? '')
        expect(auth).toBe('Bearer user-jwt')
        expect(auth).not.toContain('sk_cloud_')
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      })
    )

  it('maps every membership to Studio\'s shape with a numeric id and the role', async () => {
    stubFetch({
      orgs: [
        { id: 'b725a4ef-1e65-4aae-937b-7535481149cd', name: 'Aiya', slug: 'aiya', role: 'owner' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Artistsuite Inc.', slug: 'artistsuite', role: 'admin' },
      ],
    })
    const res = await userOrgs('user-jwt')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toEqual([
      { uuid: 'b725a4ef-1e65-4aae-937b-7535481149cd', id: numericIdFor('b725a4ef-1e65-4aae-937b-7535481149cd'), name: 'Aiya', slug: 'aiya', role: 'owner' },
      { uuid: '22222222-2222-4222-8222-222222222222', id: numericIdFor('22222222-2222-4222-8222-222222222222'), name: 'Artistsuite Inc.', slug: 'artistsuite', role: 'admin' },
    ])
  })

  it('derives a slug when the engine sends none, and defaults a missing role', async () => {
    stubFetch({ orgs: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Beta Co' }] })
    const res = await userOrgs('user-jwt')
    expect(res.ok && res.data[0]).toMatchObject({ slug: 'beta-co', role: 'member' })
  })

  it('surfaces the engine\'s failure instead of inventing an org', async () => {
    stubFetch({ error: 'unauthorized' }, 401)
    const res = await userOrgs('user-jwt')
    expect(res).toMatchObject({ ok: false, reason: 'http_error' })
  })
})

describe('findUserOrg', () => {
  const orgsBody = {
    orgs: [
      { id: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'Aiya', slug: 'aiya', role: 'owner' },
      { id: 'bbbbbbbb-0000-4000-8000-000000000000', name: 'Beta', slug: 'beta', role: 'viewer' },
    ],
  }
  const stub = (body: unknown, status = 200) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })))

  it('returns the matching workspace', async () => {
    stub(orgsBody)
    const res = await findUserOrg('user-jwt', 'beta')
    expect(res.ok && res.data?.slug).toBe('beta')
    expect(res.ok && res.data?.role).toBe('viewer')
  })

  it('returns null when the user is not a member of that slug (never another org)', async () => {
    stub(orgsBody)
    const res = await findUserOrg('user-jwt', 'someone-elses-org')
    expect(res).toMatchObject({ ok: true, data: null })
  })
})

describe('listUserSites', () => {
  it('forwards the user token and names the workspace with x-taskclan-org', async () => {
    const seen: { auth?: string; org?: string } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const h = (init?.headers ?? {}) as Record<string, string>
        seen.auth = h.authorization
        seen.org = h['x-taskclan-org']
        return new Response(JSON.stringify({ sites: [{ id: 's1' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      })
    )
    const res = await listUserSites('user-jwt', 'aiya')
    expect(res.ok).toBe(true)
    expect(seen.auth).toBe('Bearer user-jwt')
    expect(seen.org).toBe('aiya')
  })
})
