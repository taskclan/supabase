/**
 * What the browser sends with a request to this console's own routes.
 *
 * Two headers decide which tenant's data comes back, so the interesting cases
 * are the ones where a header is silently absent: the request still succeeds,
 * against somebody else's organisation or through the shared key, and nothing
 * about the response says so.
 *
 * Imported dynamically because TASKCLAN_AUTH_ENABLED is a build-time constant
 * read at module load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEYS = ['NEXT_PUBLIC_TASKCLAN_AUTH_URL', 'NEXT_PUBLIC_TASKCLAN_AUTH_ANON_KEY'] as const
let saved: Record<string, string | undefined> = {}

const getAccessToken = vi.fn(async () => 'user-token' as string | undefined)

vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('common')>()),
  getAccessToken: () => getAccessToken(),
}))

async function load(authOn: boolean) {
  vi.resetModules()
  if (authOn) {
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_URL = 'https://proj.supabase.co'
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_ANON_KEY = 'anon'
  } else {
    for (const k of KEYS) delete process.env[k]
  }
  return import('./fetchTaskclan')
}

function headersOf(mock: ReturnType<typeof vi.fn>): Headers {
  return new Headers((mock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers)
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  getAccessToken.mockResolvedValue('user-token')
  try {
    globalThis.localStorage?.clear()
  } catch {
    // Not every environment has one; the helper copes and so does this.
  }
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('taskclanFetch', () => {
  it('sends the caller and their organisation once auth is on', async () => {
    const { taskclanFetch } = await load(true)
    const { setActiveOrg } = await import('./activeOrg')
    setActiveOrg('acme')
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await taskclanFetch('/api/taskclan/app/env')

    const headers = headersOf(fetchMock)
    expect(headers.get('authorization')).toBe('Bearer user-token')
    expect(headers.get('x-taskclan-org')).toBe('acme')
  })

  it('does not touch the request before auth is configured', async () => {
    // Call sites were converted long before there was anything to send, so the
    // helper has to be a faithful pass-through until then.
    const { taskclanFetch } = await load(false)
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await taskclanFetch('/api/taskclan/app/env')

    expect(headersOf(fetchMock).get('authorization')).toBeNull()
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('keeps the caller-supplied headers and method', async () => {
    const { taskclanFetch } = await load(true)
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await taskclanFetch('/api/taskclan/app/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  })

  it('still sends the request when the session cannot be read', async () => {
    // Signed out is not an error worth throwing inside a component effect: the
    // route answers through the shared key while the fallback is on, and a 401
    // afterwards is a better outcome than an unhandled rejection.
    const { taskclanFetch } = await load(true)
    getAccessToken.mockRejectedValueOnce(new Error('no session'))
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(taskclanFetch('/api/taskclan/app/env')).resolves.toBeDefined()
    expect(headersOf(fetchMock).get('authorization')).toBeNull()
  })

  it('reads the token fresh on every call', async () => {
    // Caching it, which is what the engine's console does, leaves a window
    // between expiry and the refresh event where requests carry a stale token.
    const { taskclanFetch } = await load(true)
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await taskclanFetch('/api/taskclan/app/env')
    await taskclanFetch('/api/taskclan/app/env')

    expect(getAccessToken).toHaveBeenCalledTimes(2)
  })
})
