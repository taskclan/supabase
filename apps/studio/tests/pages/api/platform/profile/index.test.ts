/**
 * Who the console says you are.
 *
 * Upstream answers with a fixed John Doe, which is fine for a console with no
 * users and wrong once there are. The id is not decoration either:
 * `useLastVisitedOrganization` keys localStorage on it, so a constant id means
 * two people sharing a browser profile inherit each other's organisation.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../pages/api/platform/profile/index'

function tokenFor(sub: string, email: string): string {
  const body = Buffer.from(JSON.stringify({ sub, email }), 'utf8').toString('base64url')
  return `header.${body}.signature`
}

const orgsFor = (name: string, slug: string) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ activeOrgId: 'org-1', orgs: [{ id: 'org-1', name, slug }] }),
  }))

beforeEach(() => {
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = 'sk_cloud_' + 'a'.repeat(48)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const get = async (authorization?: string) => {
  const { req, res } = createMocks({ method: 'GET', headers: authorization ? { authorization } : {} })
  await handler(req as never, res as never)
  return res
}

describe('GET /api/platform/profile', () => {
  it('answers a signed-in person with their own identity', async () => {
    vi.stubGlobal('fetch', orgsFor('Acme', 'acme'))

    const res = await get(`Bearer ${tokenFor('user-a', 'ada@example.com')}`)
    const body = res._getJSONData()

    expect(body.primary_email).toBe('ada@example.com')
    expect(body.gotrue_id).toBe('user-a')
    expect(JSON.stringify(body)).not.toContain('johndoe')
  })

  it('gives two people different ids', async () => {
    // The whole point of the numeric id: localStorage is keyed on it.
    vi.stubGlobal('fetch', orgsFor('Acme', 'acme'))
    const a = (await get(`Bearer ${tokenFor('user-a', 'ada@example.com')}`))._getJSONData()
    const b = (await get(`Bearer ${tokenFor('user-b', 'bob@example.com')}`))._getJSONData()

    expect(a.id).not.toBe(b.id)
  })

  it('reports the real organisations rather than an invented one', async () => {
    vi.stubGlobal('fetch', orgsFor('Globex', 'globex'))

    const body = (await get(`Bearer ${tokenFor('user-a', 'ada@example.com')}`))._getJSONData()

    expect(body.organizations).toHaveLength(1)
    expect(body.organizations[0]).toMatchObject({ name: 'Globex', slug: 'globex' })
  })

  it('invents no first or last name', async () => {
    // Cloud holds no display name. Filling one in puts words in someone's mouth
    // on every screen that greets them by name.
    vi.stubGlobal('fetch', orgsFor('Acme', 'acme'))

    const body = (await get(`Bearer ${tokenFor('user-a', 'ada@example.com')}`))._getJSONData()

    expect(body.first_name).toBe('')
    expect(body.last_name).toBe('')
  })

  it('keeps the stub for a caller with no session', async () => {
    // There is no person behind the shared key, so there is no identity to
    // report and upstream's placeholder is the truthful answer.
    const res = await get()

    expect(res.getHeader('x-taskclan-source')).toBe('stub')
    expect(res._getJSONData().primary_email).toBe('johndoe@supabase.io')
  })

  it('does not trust a forged token that Cloud rejects', async () => {
    // The claims are read without checking the signature, so Cloud accepting
    // the token is what makes them trustworthy. If it refuses, so does this.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad jwt' })))

    const res = await get(`Bearer ${tokenFor('impostor', 'admin@example.com')}`)

    expect(res._getStatusCode()).toBe(502)
    expect(res._getData()).not.toContain('admin@example.com')
  })
})
