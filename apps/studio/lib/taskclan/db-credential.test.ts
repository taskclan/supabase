import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

    const r = await credentialForRef('gamenova')
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
    const r = await credentialForRef('nani')
    expect(r).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(JSON.stringify(r)).not.toContain('postgresql://')
  })

  it('distinguishes an unknown app from an unconfigured one', async () => {
    // Different fixes: one is a typo in a URL, the other is "run the
    // provisioner". Collapsing them sends people to the wrong one.
    vi.stubGlobal('fetch', vi.fn(async () => sites([{ id: 'site-1', name: 'gamenova', subdomain: 'gamenova' }])))
    const r = await credentialForRef('does-not-exist')
    expect(r).toMatchObject({ ok: false, reason: 'no_such_app' })
  })

  it('reports a refused key as unauthorized, not as missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/db-credential')
        ? { ok: false, status: 403, json: async () => ({}) }
        : sites([{ id: 'site-1', name: 'gamenova', subdomain: 'gamenova' }])
    ))
    expect(await credentialForRef('gamenova')).toMatchObject({ ok: false, reason: 'unauthorized' })
  })

  it('never throws into the query path on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    const r = await credentialForRef('gamenova')
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
    await credentialForRef('gamenova')
    const after = fetchMock.mock.calls.length
    await credentialForRef('gamenova')
    await credentialForRef('gamenova')
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
    expect(await credentialForRef('gamenova')).toMatchObject({ ok: false })
    configured = true
    expect(await credentialForRef('gamenova')).toMatchObject({ ok: true })
  })

  it('says so when Taskclan is not configured, without calling the network', async () => {
    delete process.env.TASKCLAN_CLOUD_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await credentialForRef('gamenova')).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(perAppCredentialsEnabled()).toBe(false)
  })
})
