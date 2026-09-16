/**
 * The Team page's data, which was two red panels before these routes existed.
 *
 * The mapping is the part worth testing. Studio types Member_Output with every
 * field required, so the temptation is to fill the gaps with something
 * plausible, and a plausible value here is a claim: an avatar nobody set, a
 * name nobody chose, an MFA state nobody computed.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../pages/api/platform/organizations/[slug]/members'

const ORGS = [{ id: 'org-uuid', name: "dnlamah1's workspace", slug: 'dnlamah1-s-workspace' }]

function cloud(members: unknown[]) {
  return vi.fn(async (url: string) => {
    if (url.includes('/orgs') && url.endsWith('/members')) {
      return { ok: true, status: 200, json: async () => ({ members }) }
    }
    return { ok: true, status: 200, json: async () => ({ activeOrgId: 'org-uuid', orgs: ORGS }) }
  })
}

beforeEach(() => {
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = 'sk_cloud_' + 'a'.repeat(48)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const get = async (slug = 'dnlamah1-s-workspace') => {
  const { req, res } = createMocks({ method: 'GET', query: { slug } })
  await handler(req as never, res as never)
  return res
}

describe('GET /api/platform/organizations/[slug]/members', () => {
  it('maps a Cloud member into the shape Studio renders', async () => {
    vi.stubGlobal(
      'fetch',
      cloud([{ userId: 'u1', role: 'owner', name: 'Daniel Amah', email: 'ada@example.com' }])
    )

    const body = (await get())._getJSONData()

    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({
      gotrue_id: 'u1',
      primary_email: 'ada@example.com',
      username: 'Daniel Amah',
      role_ids: [1],
    })
  })

  it('gives each Cloud role its own id', async () => {
    // Studio resolves a member's role by matching role_ids against the roles
    // endpoint. Collapsing two roles onto one id would silently relabel people.
    vi.stubGlobal(
      'fetch',
      cloud([
        { userId: 'u1', role: 'owner' },
        { userId: 'u2', role: 'admin' },
        { userId: 'u3', role: 'member' },
      ])
    )

    const ids = (await get())._getJSONData().map((m: { role_ids: number[] }) => m.role_ids[0])

    expect(new Set(ids).size).toBe(3)
  })

  it('claims nothing about MFA', async () => {
    // Cloud does not track it, and the cell upstream draws has no unknown
    // state: anything falsy renders as "Disabled" with a cross. The column is
    // hidden instead, so this value must never become a real-looking true.
    vi.stubGlobal('fetch', cloud([{ userId: 'u1', role: 'owner', email: 'ada@example.com' }]))

    expect((await get())._getJSONData()[0].mfa_enabled).toBe(false)
  })

  it('invents no avatar and no display name', async () => {
    // A member Cloud knows only by id. Studio takes the avatar initial from
    // `username`, so an empty string renders a blank chip; the id prefix is at
    // least a true identifier.
    vi.stubGlobal('fetch', cloud([{ userId: 'abcdef123456', role: 'member' }]))

    const member = (await get())._getJSONData()[0]

    expect(member.avatar_url).toBeNull()
    expect(member.username).toBe('abcdef12')
    expect(member.primary_email).toBeNull()
  })

  it('falls back to the email local part when there is no name', async () => {
    vi.stubGlobal('fetch', cloud([{ userId: 'u1', role: 'member', email: 'ada@example.com' }]))

    expect((await get())._getJSONData()[0].username).toBe('ada')
  })

  it('is a 404 for an org the caller does not belong to', async () => {
    vi.stubGlobal('fetch', cloud([]))

    expect((await get('someone-elses-org'))._getStatusCode()).toBe(404)
  })
})
