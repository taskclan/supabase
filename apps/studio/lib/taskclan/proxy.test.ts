import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudProxy } from './proxy'

/**
 * The authenticated pass-through: it must act as the SIGNED-IN USER (their
 * token, never the shared key), name the workspace, forward the query/body, and
 * relay the engine's own answer — field-level errors included.
 */

const KEYS = ['TASKCLAN_CLOUD_URL', 'TASKCLAN_CLOUD_API_KEY', 'TASKCLAN_MULTI_TENANT'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = 'sk_cloud_' + 'a'.repeat(48)
  process.env.TASKCLAN_MULTI_TENANT = 'true'
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
})

function fakeReq(over: Partial<NextApiRequest>): NextApiRequest {
  return { method: 'GET', headers: {}, query: {}, body: undefined, ...over } as NextApiRequest
}
function fakeRes() {
  const out: { status: number; body: unknown; headers: Record<string, unknown> } = { status: 0, body: undefined, headers: {} }
  const res = {
    status(code: number) {
      out.status = code
      return res
    },
    json(b: unknown) {
      out.body = b
      return res
    },
    send(b: unknown) {
      out.body = b
      return res
    },
    setHeader(k: string, v: unknown) {
      out.headers[k] = v
      return res
    },
  }
  return { res: res as unknown as NextApiResponse, out }
}

describe('cloudProxy', () => {
  it('forwards the user token + x-taskclan-org + query (minus slug), and relays the engine body', async () => {
    const seen: { url?: string; headers?: Record<string, string>; method?: string } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.url = url
        seen.headers = init?.headers as Record<string, string>
        seen.method = init?.method
        return new Response(JSON.stringify({ domains: [{ name: 'aiyalogistics.com' }], note: 'indicative' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })
    )
    const { res, out } = fakeRes()
    await cloudProxy(fakeReq({ query: { slug: 'aiya', q: 'aiyalogistics', limit: '8' }, headers: { authorization: 'Bearer user-jwt' } }), res, {
      enginePath: '/api/cloud/v1/domains/search',
      methods: ['GET'],
    })
    expect(seen.url).toBe('https://engine.taskclan.com/api/cloud/v1/domains/search?q=aiyalogistics&limit=8')
    expect(seen.headers?.authorization).toBe('Bearer user-jwt')
    expect(seen.headers?.['x-taskclan-org']).toBe('aiya')
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ domains: [{ name: 'aiyalogistics.com' }] })
  })

  it('forwards the body on POST and relays a field-level error unchanged', async () => {
    let sentBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ error: 'registrant contact is incomplete', missing: ['phone', 'city'] }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      })
    )
    const { res, out } = fakeRes()
    await cloudProxy(
      fakeReq({ method: 'POST', query: { slug: 'aiya' }, headers: { authorization: 'Bearer user-jwt' }, body: { name: 'Dan' } }),
      res,
      { enginePath: '/api/cloud/v1/domains/registrant', methods: ['GET', 'POST'] }
    )
    expect(sentBody).toEqual({ name: 'Dan' })
    expect(out.status).toBe(400)
    expect(out.body).toEqual({ error: 'registrant contact is incomplete', missing: ['phone', 'city'] })
  })

  it('refuses when multi-tenant is off, without calling the engine', async () => {
    process.env.TASKCLAN_MULTI_TENANT = 'false'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { res, out } = fakeRes()
    await cloudProxy(fakeReq({ query: { slug: 'aiya' }, headers: { authorization: 'Bearer user-jwt' } }), res, {
      enginePath: '/api/cloud/v1/domains/search',
      methods: ['GET'],
    })
    expect(out.status).toBe(501)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('needs a user token (401) and a slug (400)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const a = fakeRes()
    await cloudProxy(fakeReq({ query: { slug: 'aiya' } }), a.res, { enginePath: '/x', methods: ['GET'] })
    expect(a.out.status).toBe(401)

    const b = fakeRes()
    await cloudProxy(fakeReq({ headers: { authorization: 'Bearer user-jwt' } }), b.res, { enginePath: '/x', methods: ['GET'] })
    expect(b.out.status).toBe(400)
  })

  it('405s a method the route does not allow', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { res, out } = fakeRes()
    await cloudProxy(fakeReq({ method: 'DELETE', query: { slug: 'aiya' }, headers: { authorization: 'Bearer user-jwt' } }), res, {
      enginePath: '/api/cloud/v1/domains/register',
      methods: ['POST'],
    })
    expect(out.status).toBe(405)
  })
})
