/**
 * Creating an organization from the console.
 *
 * Studio's New organization form posts to /platform/organizations, and this
 * route answered 405, so "Create organization" never worked from this console.
 * It now makes a Taskclan workspace with the caller as owner, and answers with
 * the organization exactly as the list shows it: Studio appends the answer to
 * its cached list and routes on its slug.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../pages/api/platform/organizations'

const USER = { authorization: 'Bearer user-session-token' }
const PERSONAL = { id: 'org-personal', name: "Dan's workspace", slug: 'dan-s-workspace', plan: 'pro' }
const AIYA = { id: 'org-aiya', name: 'Aiya', slug: 'aiya', plan: 'free' }

function cloud(opts: { create?: { status: number; body: unknown } } = {}) {
  const created = { done: false }
  return vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      const answer = opts.create ?? { status: 200, body: { org: AIYA } }
      if (answer.status < 400) created.done = true
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body }
    }
    // GET /api/cloud/v1/orgs: the list, with the new one once it exists.
    return {
      ok: true,
      status: 200,
      json: async () => ({ activeOrgId: PERSONAL.id, orgs: created.done ? [PERSONAL, AIYA] : [PERSONAL] }),
      text: async () => '',
    }
  })
}

const call = async (method: string, body?: unknown, headers: Record<string, string> = USER) => {
  const { req, res } = createMocks({ method: method as 'POST', body: body as never, headers })
  await handler(req as never, res as never)
  return res
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

describe('POST /api/platform/organizations', () => {
  it('creates the workspace as the caller and answers with it as the list shows it', async () => {
    const fetch = cloud()
    vi.stubGlobal('fetch', fetch)

    const res = await call('POST', { name: '  Aiya ', kind: 'COMPANY', size: '1_10', tier: 'tier_free' })

    expect(res._getStatusCode()).toBe(201)
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[0]).toBe('https://engine.taskclan.com/api/cloud/v1/orgs')
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({ name: 'Aiya' })
    expect((post?.[1] as { headers: Record<string, string> }).headers.authorization).toBe(USER.authorization)

    const org = res._getJSONData()
    expect(org).toMatchObject({ name: 'Aiya', slug: 'aiya', billing_email: null, plan: { id: 'enterprise', name: 'Free' } })
    // The same number GET gives it, which is how Studio matches apps to it.
    const listed = (await call('GET'))._getJSONData() as Array<{ slug: string; id: number }>
    expect(org.id).toBe(listed.find((o) => o.slug === 'aiya')?.id)
  })

  it('refuses a name shorter than two characters before asking Cloud', async () => {
    const fetch = cloud()
    vi.stubGlobal('fetch', fetch)

    const res = await call('POST', { name: 'A' })

    expect(res._getStatusCode()).toBe(400)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it("won't create one with the shared key, which belongs to whoever minted it", async () => {
    const fetch = cloud()
    vi.stubGlobal('fetch', fetch)

    const res = await call('POST', { name: 'Aiya' }, {})

    expect(res._getStatusCode()).toBe(403)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it("passes Cloud's refusal through with its reason", async () => {
    vi.stubGlobal('fetch', cloud({ create: { status: 403, body: { error: 'member limit reached' } } }))

    const res = await call('POST', { name: 'Aiya' })

    expect(res._getStatusCode()).toBe(403)
    expect(res._getJSONData().error.message).toBe('member limit reached')
  })

  it('names both methods it takes', async () => {
    const res = await call('PUT')
    expect(res._getStatusCode()).toBe(405)
    expect(res._getHeaders().allow).toEqual(['GET', 'POST'])
  })
})
