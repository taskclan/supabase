/**
 * Deleting a workspace from the console.
 *
 * The Delete organization button got a 405 from this route, and the toast said
 * only "API error happened while trying to communicate with the server". It now
 * forwards the delete to the engine for the workspace the slug names, under the
 * caller's own token. Whatever the engine says when it refuses ("cancel the
 * plan first") has to reach the toast, which reads `message` at the top of the
 * body.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../pages/api/platform/organizations/[slug]/index'

const ORGS = [
  { id: 'personal-uuid', name: "Dan's workspace", slug: 'dan-s-workspace' },
  { id: 'artist-uuid', name: 'ArtistSuite', slug: 'artistsuite' },
]
// Any bearer that is not an sk_cloud_ key is a signed-in person.
const USER = { authorization: 'Bearer user-session-token' }

function cloud(deleteAnswer: { status: number; body: unknown }) {
  return vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'DELETE') {
      return { ok: deleteAnswer.status < 400, status: deleteAnswer.status, json: async () => deleteAnswer.body }
    }
    return { ok: true, status: 200, json: async () => ({ activeOrgId: 'personal-uuid', orgs: ORGS }) }
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

const call = async (method: string, slug: string, headers: Record<string, string> = USER) => {
  const { req, res } = createMocks({ method: method as 'DELETE', query: { slug }, headers })
  await handler(req as never, res as never)
  return res
}

describe('DELETE /api/platform/organizations/[slug]', () => {
  it("deletes the workspace the slug names, by its id, as the caller", async () => {
    const fetch = cloud({ status: 200, body: { ok: true } })
    vi.stubGlobal('fetch', fetch)

    const res = await call('DELETE', 'artistsuite')

    expect(res._getStatusCode()).toBe(200)
    expect(res._getJSONData()).toMatchObject({ slug: 'artistsuite', name: 'ArtistSuite' })
    const del = fetch.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(del?.[0]).toBe('https://engine.taskclan.com/api/cloud/v1/orgs/artist-uuid')
    expect((del?.[1] as { headers: Record<string, string> }).headers.authorization).toBe(USER.authorization)
  })

  it("puts the engine's reason for refusing where the toast reads it", async () => {
    const reason = 'This workspace is on the Pro plan. Cancel the plan in Billing, and delete the workspace once it has ended.'
    vi.stubGlobal('fetch', cloud({ status: 409, body: { error: reason, code: 'blocked', blockers: [] } }))

    const res = await call('DELETE', 'artistsuite')

    expect(res._getStatusCode()).toBe(409)
    expect(res._getJSONData().message).toBe(reason)
  })

  it('will not delete with the shared key, which acts for nobody', async () => {
    const fetch = cloud({ status: 200, body: { ok: true } })
    vi.stubGlobal('fetch', fetch)

    const res = await call('DELETE', 'artistsuite', {})

    expect(res._getStatusCode()).toBe(403)
    expect(res._getJSONData().message).toMatch(/sign in/i)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it("answers 404 for a workspace that isn't the caller's", async () => {
    const fetch = cloud({ status: 200, body: { ok: true } })
    vi.stubGlobal('fetch', fetch)

    const res = await call('DELETE', 'someone-elses')

    expect(res._getStatusCode()).toBe(404)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('names the methods it takes, readably', async () => {
    const res = await call('PUT', 'artistsuite')

    expect(res._getStatusCode()).toBe(405)
    expect(res._getHeaders().allow).toEqual(['PATCH', 'DELETE'])
    expect(res._getJSONData().message).toBe('Method PUT Not Allowed')
  })
})
