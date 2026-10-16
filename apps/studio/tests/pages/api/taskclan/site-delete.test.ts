/**
 * Deleting an app, which is the one action here that cannot be undone.
 *
 * The tenancy shape is covered once in `tenancy.test.ts` for every proxy that
 * shares the lookup. This route gets its own file for the properties that are
 * specific to destruction: that a cross-tenant delete never reaches the engine
 * at all, that an outage is not reported as a successful delete or as a missing
 * app, and that the engine's own refusal survives instead of being flattened.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import siteHandler from '../../../../pages/api/taskclan/[ref]/site'

function tokenFor(sub: string): string {
  const body = Buffer.from(JSON.stringify({ sub, email: `${sub}@example.com` }), 'utf8').toString(
    'base64url'
  )
  return `header.${body}.signature`
}

function subjectOf(token: string): string | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    return (
      (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string }).sub ??
      null
    )
  } catch {
    return null
  }
}

const ENV = ['TASKCLAN_CLOUD_URL', 'TASKCLAN_CLOUD_API_KEY', 'TASKCLAN_SHARED_KEY_FALLBACK'] as const
let saved: Record<string, string | undefined> = {}

/** Cloud as two tenants: user-a owns "acme-app"; user-b owns nothing. */
function cloudWithTenants(deleteResponse?: { ok: boolean; status: number; body: unknown }) {
  return vi.fn(async (url: string, init?: { method?: string; headers: Record<string, string> }) => {
    const token = (init?.headers.authorization ?? '').replace('Bearer ', '')
    const isList = url.includes('/api/cloud/v1/sites') && !/\/sites\/[^/?]+$/.test(url)
    if (isList) {
      const mine = token.startsWith('sk_cloud_') || subjectOf(token) === 'user-a'
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sites: mine
            ? [{ id: 'site-a', name: 'acme-app', subdomain: 'acme-app', status: 'ready' }]
            : [],
        }),
      }
    }
    const r = deleteResponse ?? { ok: true, status: 200, body: { ok: true } }
    return { ok: r.ok, status: r.status, json: async () => r.body }
  })
}

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = 'sk_cloud_' + 'a'.repeat(48)
  delete process.env.TASKCLAN_SHARED_KEY_FALLBACK
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const call = async (method: 'GET' | 'DELETE', ref: string, authorization?: string) => {
  const { req, res } = createMocks({
    method,
    query: { ref },
    headers: authorization ? { authorization } : {},
  })
  await siteHandler(req as never, res as never)
  return res
}

const deleteCalls = (mock: ReturnType<typeof cloudWithTenants>) =>
  mock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'DELETE')

describe('deleting an app belonging to another tenant', () => {
  it('never issues the delete upstream', async () => {
    // The point of the assertion on `deleteCalls`: a route that forwarded and
    // let the engine refuse would be *correct* today and catastrophic the day
    // the engine's own check regressed. The console must not be the only thing
    // standing between a stranger and someone else's app, but it must also not
    // be the thing that hands the engine the request in the first place.
    const fetchMock = cloudWithTenants()
    vi.stubGlobal('fetch', fetchMock)

    const res = await call('DELETE', 'acme-app', `Bearer ${tokenFor('user-b')}`)

    expect(res._getStatusCode()).toBe(404)
    expect(deleteCalls(fetchMock)).toHaveLength(0)
  })

  it('deletes for the tenant who owns it', async () => {
    // The counterpart, so the test above cannot pass by refusing everybody.
    const fetchMock = cloudWithTenants()
    vi.stubGlobal('fetch', fetchMock)

    const res = await call('DELETE', 'acme-app', `Bearer ${tokenFor('user-a')}`)

    expect(res._getStatusCode()).toBe(200)
    expect(deleteCalls(fetchMock)).toHaveLength(1)
    expect(String(deleteCalls(fetchMock)[0][0])).toContain('/sites/site-a')
  })
})

describe('when Cloud cannot be reached', () => {
  it('does not report the app as already gone', async () => {
    // A 404 here reads as "your app no longer exists", which during an outage
    // is both false and alarming. 502 says the console could not look.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )

    const res = await call('DELETE', 'acme-app', `Bearer ${tokenFor('user-a')}`)

    expect(res._getStatusCode()).toBe(502)
  })

  it('does not report a failed delete as success', async () => {
    // The worst outcome for a destructive action: the UI says deleted, the app
    // is still running and still billing.
    const fetchMock = cloudWithTenants({
      ok: false,
      status: 500,
      body: { error: 'failed to delete site' },
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await call('DELETE', 'acme-app', `Bearer ${tokenFor('user-a')}`)

    expect(res._getStatusCode()).toBe(500)
    expect(JSON.parse(res._getData()).ok).not.toBe(true)
  })

  it("passes the engine's refusal through instead of flattening it", async () => {
    // "Your role cannot delete production apps" tells someone what to do next.
    // "Delete failed" makes them retry something that will never work.
    vi.stubGlobal(
      'fetch',
      cloudWithTenants({
        ok: false,
        status: 403,
        body: { error: 'your role cannot delete this app' },
      })
    )

    const res = await call('DELETE', 'acme-app', `Bearer ${tokenFor('user-a')}`)

    expect(res._getStatusCode()).toBe(403)
    expect(JSON.parse(res._getData()).error).toContain('role cannot delete')
  })
})

describe('the route surface', () => {
  it('offers no way to rename, because the engine has none', async () => {
    // A PATCH that quietly did nothing would be worse than its absence.
    const { req, res } = createMocks({ method: 'PATCH', query: { ref: 'acme-app' } })
    await siteHandler(req as never, res as never)

    expect(res._getStatusCode()).toBe(405)
    expect(res._getHeaders().allow).toBe('GET, DELETE')
  })

  it('reads identity without touching the engine a second time', async () => {
    // The caller's own site list is what tenancy was checked against; re-reading
    // the app from anywhere else would be reading around that check.
    const fetchMock = cloudWithTenants()
    vi.stubGlobal('fetch', fetchMock)

    const res = await call('GET', 'acme-app', `Bearer ${tokenFor('user-a')}`)

    expect(res._getStatusCode()).toBe(200)
    expect(JSON.parse(res._getData()).site.name).toBe('acme-app')
    expect(fetchMock.mock.calls.filter(([url]) => /\/sites\/site-a$/.test(String(url)))).toHaveLength(0)
  })
})
