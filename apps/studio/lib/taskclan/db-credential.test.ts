import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Caller } from './callerContext'
import { credentialForRef, perAppCredentialsEnabled, resetCredentialCache } from './db-credential'

/**
 * Resolving one app's database connection.
 *
 * The test that matters is the one asserting it does NOT fall back. A per-request
 * fallback to the shared connection would leave the SQL editor working while
 * pointed at the database that holds cloud_api_keys — and a working editor is
 * exactly what stops anyone noticing.
 */

const ENV = ['TASKCLAN_CLOUD_URL', 'TASKCLAN_CLOUD_API_KEY'] as const
let saved: Record<string, string | undefined> = {}
const KEY = 'sk_cloud_' + 'a'.repeat(48)
const URL_VALUE = 'postgresql://gamenova_studio.ref:pw@aws-1-ca-central-1.pooler.supabase.com:6543/postgres'

const sites = (rows: unknown[]) => ({ ok: true, status: 200, json: async () => ({ sites: rows }) })

/** A JWT shaped like Supabase's. Only the `sub` claim is read, to partition the cache. */
function userCaller(sub: string): Caller {
  const body = Buffer.from(JSON.stringify({ sub }), 'utf8').toString('base64url')
  return { kind: 'user', token: `header.${body}.signature`, org: null }
}

const SHARED: Caller = { kind: 'shared', key: KEY }

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = KEY
  resetCredentialCache()
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
})

describe('credentialForRef', () => {
  it('returns the scoped connection string', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/db-credential')
        ? { ok: true, status: 200, json: async () => ({ configured: true, connectionString: URL_VALUE }) }
        : sites([{ id: 'site-1', name: 'gamenova', subdomain: 'gamenova' }])
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await credentialForRef('gamenova', SHARED)
    expect(r).toEqual({ ok: true, connectionString: URL_VALUE })
    // Resolved the ref to a site id first, then asked for that site's credential.
    expect(String(fetchMock.mock.calls[1][0])).toContain('/sites/site-1/db-credential')
  })

  it('does NOT fall back when an app has no credential — the whole point', async () => {
    // Returning the shared connection here is the bug. The editor would work,
    // against the database holding cloud_api_keys.
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/db-credential')
        ? { ok: false, status: 404, json: async () => ({ configured: false, reason: 'STUDIO_DATABASE_URL is not set for this app in production' }) }
        : sites([{ id: 'site-1', name: 'nani', subdomain: 'nani' }])
    ))
    const r = await credentialForRef('nani', SHARED)
    expect(r).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(JSON.stringify(r)).not.toContain('postgresql://')
  })

  it('distinguishes an unknown app from an unconfigured one', async () => {
    // Different fixes: one is a typo in a URL, the other is "run the
    // provisioner". Collapsing them sends people to the wrong one.
    vi.stubGlobal('fetch', vi.fn(async () => sites([{ id: 'site-1', name: 'gamenova', subdomain: 'gamenova' }])))
    const r = await credentialForRef('does-not-exist', SHARED)
    expect(r).toMatchObject({ ok: false, reason: 'no_such_app' })
  })

  it('reports a refused key as unauthorized, not as missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/db-credential')
        ? { ok: false, status: 403, json: async () => ({}) }
        : sites([{ id: 'site-1', name: 'gamenova', subdomain: 'gamenova' }])
    ))
    expect(await credentialForRef('gamenova', SHARED)).toMatchObject({ ok: false, reason: 'unauthorized' })
  })

  it('never throws into the query path on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    const r = await credentialForRef('gamenova', SHARED)
    expect(r).toMatchObject({ ok: false, reason: 'network_error' })
    expect((r as { detail: string }).detail).toContain('ECONNRESET')
  })

  it('caches, so the SQL editor is not one round trip per keystroke', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/db-credential')
        ? { ok: true, status: 200, json: async () => ({ connectionString: URL_VALUE }) }
        : sites([{ id: 'site-1', name: 'gamenova', subdomain: 'gamenova' }])
    )
    vi.stubGlobal('fetch', fetchMock)
    await credentialForRef('gamenova', SHARED)
    const after = fetchMock.mock.calls.length
    await credentialForRef('gamenova', SHARED)
    await credentialForRef('gamenova', SHARED)
    expect(fetchMock.mock.calls.length).toBe(after)
  })

  it('does not cache a failure', async () => {
    // A credential provisioned a minute later must be picked up without a
    // restart; caching the miss would make the fix look like it did not work.
    let configured = false
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.includes('/db-credential')) return sites([{ id: 'site-1', name: 'gamenova', subdomain: 'gamenova' }])
      return configured
        ? { ok: true, status: 200, json: async () => ({ connectionString: URL_VALUE }) }
        : { ok: false, status: 404, json: async () => ({ configured: false, reason: 'not set' }) }
    }))
    expect(await credentialForRef('gamenova', SHARED)).toMatchObject({ ok: false })
    configured = true
    expect(await credentialForRef('gamenova', SHARED)).toMatchObject({ ok: true })
  })

  it('does not hand one caller another caller\'s cached connection string', async () => {
    // Keyed by ref alone, this cache was process wide: the first person to open
    // an app's SQL editor left a working connection string, password included,
    // for whoever asked for that ref next. Correct while one shared key was the
    // only way in, and a cross-tenant read the moment it is not.
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      const token = init.headers.authorization.replace('Bearer ', '')
      if (!url.includes('/db-credential')) {
        // Each user sees only their own apps, which is what the engine does.
        return token.includes(Buffer.from('{"sub":"user-a"}', 'utf8').toString('base64url'))
          ? sites([{ id: 'site-a', name: 'shared-name', subdomain: 'shared-name' }])
          : sites([])
      }
      return { ok: true, status: 200, json: async () => ({ connectionString: URL_VALUE }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const mine = await credentialForRef('shared-name', userCaller('user-a'))
    expect(mine).toMatchObject({ ok: true })

    const theirs = await credentialForRef('shared-name', userCaller('user-b'))
    expect(theirs).toMatchObject({ ok: false, reason: 'no_such_app' })
    expect(JSON.stringify(theirs)).not.toContain('postgresql://')
  })

  it('never asks for a credential for an app the caller cannot see', async () => {
    // The refusal has to happen at the lookup, not at the engine. Asking and
    // being refused would still confirm the app exists, and would rely on the
    // engine's own check rather than this one.
    const fetchMock = vi.fn(async (_url: string) =>
      sites([{ id: 'site-a', name: 'mine', subdomain: 'mine' }])
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(await credentialForRef('someone-elses-app', userCaller('user-a'))).toMatchObject({
      ok: false,
      reason: 'no_such_app',
    })
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/db-credential'))).toBe(false)
  })

  it('says so when Taskclan is not configured, without calling the network', async () => {
    // The base URL, not the key: a caller now brings its own credential, so a
    // missing key no longer means there is nothing to talk to.
    delete process.env.TASKCLAN_CLOUD_URL
    delete process.env.TASKCLAN_CLOUD_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await credentialForRef('gamenova', SHARED)).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(perAppCredentialsEnabled()).toBe(false)
  })
})
