import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listCloudSites, taskclanConfig, taskclanConfigured } from './client'

/**
 * Configuration and failure reporting.
 *
 * The reason these are tested rather than eyeballed: every one of these paths
 * ends in a dashboard that renders. A wrong answer here does not throw, it
 * shows the wrong apps — or one fake app while the real ones sit unreachable.
 */

const KEYS = ['TASKCLAN_CLOUD_URL', 'TASKCLAN_CLOUD_API_KEY'] as const
let saved: Record<string, string | undefined> = {}

const GOOD_KEY = 'sk_cloud_' + 'a'.repeat(48)

/** The console's own key, as a caller. Threaded explicitly now rather than read from env. */
const SHARED = { kind: 'shared', key: GOOD_KEY } as const

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
})

describe('taskclanConfig', () => {
  it('says which variable is missing, not just that something is', () => {
    expect(taskclanConfig()).toMatchObject({ ok: false })
    process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
    expect((taskclanConfig() as { reason: string }).reason).toContain('TASKCLAN_CLOUD_API_KEY')
    delete process.env.TASKCLAN_CLOUD_URL
    process.env.TASKCLAN_CLOUD_API_KEY = GOOD_KEY
    expect((taskclanConfig() as { reason: string }).reason).toContain('TASKCLAN_CLOUD_URL')
  })

  it('rejects a key that is not a Cloud API key', () => {
    // The likely mistake is pasting a Supabase service key or a user access
    // token. Both are long and look plausible; both would 401 much later, at
    // which point nobody remembers what they pasted.
    process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
    process.env.TASKCLAN_CLOUD_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def'
    const r = taskclanConfig()
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('sk_cloud_')
  })

  it('accepts a well-formed pair and strips a trailing slash', () => {
    process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com/'
    process.env.TASKCLAN_CLOUD_API_KEY = GOOD_KEY
    const r = taskclanConfig()
    expect(r.ok).toBe(true)
    // Without this every request path would carry a double slash.
    expect((r as { config: { url: string } }).config.url).toBe('https://engine.taskclan.com')
    expect(taskclanConfigured()).toBe(true)
  })
})

describe('listCloudSites', () => {
  beforeEach(() => {
    process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
    process.env.TASKCLAN_CLOUD_API_KEY = GOOD_KEY
  })

  it('sends the key as a bearer and reads the sites array', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sites: [{ id: 'a', name: 'engine' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await listCloudSites(SHARED)
    expect(r).toMatchObject({ ok: true })
    expect((r as { data: unknown[] }).data).toHaveLength(1)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://engine.taskclan.com/api/cloud/v1/sites')
    expect(init.headers.authorization).toBe(`Bearer ${GOOD_KEY}`)
  })

  it('reports an HTTP failure with its status rather than an empty list', async () => {
    // An empty list would render as "you have no apps", which is a different
    // and much more alarming statement than "Cloud said 401".
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })))
    const r = await listCloudSites(SHARED)
    expect(r).toMatchObject({ ok: false, reason: 'http_error' })
    expect((r as { detail: string }).detail).toContain('401')
  })

  it('reports a network failure instead of throwing into the handler', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const r = await listCloudSites(SHARED)
    expect(r).toMatchObject({ ok: false, reason: 'network_error' })
    expect((r as { detail: string }).detail).toContain('ECONNREFUSED')
  })

  it('treats a response with no sites key as empty, not as a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
    const r = await listCloudSites(SHARED)
    expect(r).toMatchObject({ ok: true })
    expect((r as { data: unknown[] }).data).toEqual([])
  })

  it('returns not_configured without calling the network', async () => {
    // Deleting the key would no longer prove this: the caller carries its own
    // credential, so a missing key is not a missing configuration any more. The
    // base URL is what a request cannot be built without.
    delete process.env.TASKCLAN_CLOUD_URL
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await listCloudSites(SHARED)
    expect(r).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
