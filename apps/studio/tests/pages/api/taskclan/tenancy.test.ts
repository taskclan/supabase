/**
 * The tenancy boundary, tested at the route rather than at the helper.
 *
 * `siteForCaller` is the check, and it is unit tested. These tests exist for a
 * different failure: a route that never calls it. Seven routes each had their
 * own copy of the lookup before it was folded, and the way that goes wrong
 * again is not a broken helper but a new route resolving a ref some other way.
 *
 * One test per shape rather than per route, because every route now shares
 * `callerFromRequest` and `siteForCaller`. Two are spot-checked to prove the
 * shared pieces are actually wired in.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import envHandler from '../../../../pages/api/taskclan/[ref]/env'

/** A JWT shaped like Supabase's. Unsigned; nothing here checks the signature. */
function tokenFor(sub: string): string {
  const body = Buffer.from(JSON.stringify({ sub, email: `${sub}@example.com` }), 'utf8').toString(
    'base64url'
  )
  return `header.${body}.signature`
}

/** Read a bearer's `sub`, the way the engine would, so the fake Cloud can scope by tenant. */
function subjectOf(token: string): string | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string }).sub ?? null
  } catch {
    return null
  }
}

const ENV = ['TASKCLAN_CLOUD_URL', 'TASKCLAN_CLOUD_API_KEY', 'TASKCLAN_SHARED_KEY_FALLBACK'] as const
let saved: Record<string, string | undefined> = {}

/** Cloud as two tenants: user-a owns "acme-app", user-b owns nothing. */
function cloudWithTenants() {
  return vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    const token = init.headers.authorization.replace('Bearer ', '')
    if (url.includes('/api/cloud/v1/sites') && !url.includes('/env')) {
      const mine = token.startsWith('sk_cloud_') || subjectOf(token) === 'user-a'
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sites: mine ? [{ id: 'site-a', name: 'acme-app', subdomain: 'acme-app' }] : [],
        }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ env: [{ key: 'SECRET_TOKEN' }] }) }
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

const callEnv = async (ref: string, authorization?: string) => {
  const { req, res } = createMocks({
    method: 'GET',
    query: { ref },
    headers: authorization ? { authorization } : {},
  })
  await envHandler(req as never, res as never)
  return res
}

describe('an app belonging to another tenant', () => {
  it('is not found, and is never asked about upstream', async () => {
    // The refusal has to happen at the lookup. Forwarding and letting Cloud
    // refuse would still confirm the app exists, and would put the console's
    // correctness in the engine's hands rather than its own.
    const fetchMock = cloudWithTenants()
    vi.stubGlobal('fetch', fetchMock)

    const res = await callEnv('acme-app', `Bearer ${tokenFor('user-b')}`)

    expect(res._getStatusCode()).toBe(404)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/env'))).toBe(false)
  })

  it('is reachable by the tenant who owns it', async () => {
    // The counterpart, so the test above cannot pass by refusing everybody.
    vi.stubGlobal('fetch', cloudWithTenants())

    const res = await callEnv('acme-app', `Bearer ${tokenFor('user-a')}`)

    expect(res._getStatusCode()).toBe(200)
  })
})

describe('credentials presented by a browser', () => {
  it('refuses a Cloud API key offered as a bearer', async () => {
    // Honouring it would scope the request to the key's org, so anyone who
    // learned a key could read that org through the console.
    vi.stubGlobal('fetch', cloudWithTenants())

    const res = await callEnv('acme-app', `Bearer sk_cloud_${'a'.repeat(48)}`)

    expect(res._getStatusCode()).toBe(401)
  })
})

describe('with no session', () => {
  it('still answers through the shared key while the fallback is on', async () => {
    // The rollout depends on this: the console keeps working before anyone can
    // sign in, and stops only when the fallback is switched off deliberately.
    vi.stubGlobal('fetch', cloudWithTenants())

    expect((await callEnv('acme-app'))._getStatusCode()).toBe(200)
  })

  it('fails closed once the fallback is switched off', async () => {
    process.env.TASKCLAN_SHARED_KEY_FALLBACK = 'false'
    vi.stubGlobal('fetch', cloudWithTenants())

    expect((await callEnv('acme-app'))._getStatusCode()).toBe(401)
  })
})
