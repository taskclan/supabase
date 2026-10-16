import type { NextApiRequest } from 'next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authHeadersFor, cacheScopeFor, callerFromRequest } from './callerContext'

/**
 * Who a request acts as, which is the whole tenancy boundary.
 *
 * Every case here is one where getting it wrong shows another customer's data
 * rather than throwing. That is why they are tested at all: none of them fails
 * loudly in a browser, and the shared-key path in particular succeeds with the
 * wrong org's apps and looks entirely normal.
 */

const KEYS = ['TASKCLAN_CLOUD_URL', 'TASKCLAN_CLOUD_API_KEY', 'TASKCLAN_SHARED_KEY_FALLBACK'] as const
let saved: Record<string, string | undefined> = {}

const SHARED_KEY = 'sk_cloud_' + 'a'.repeat(48)

/** A JWT shaped like Supabase's, signed with nothing. Only the payload is read. */
function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `header.${body}.signature`
}

function request(headers: Record<string, string> = {}): NextApiRequest {
  return { headers, url: '/api/taskclan/demo/env' } as unknown as NextApiRequest
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = SHARED_KEY
  delete process.env.TASKCLAN_SHARED_KEY_FALLBACK
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
})

describe('callerFromRequest', () => {
  it('refuses a Cloud API key presented as a browser bearer', () => {
    // The engine would accept this and scope the request to the key's org, so
    // anyone who learned a key could read that org through the console. Only
    // this side knows the request came from a browser, so the check lives here.
    const result = callerFromRequest(request({ authorization: `Bearer ${SHARED_KEY}` }))

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ status: 401 })
  })

  it('prefers a user token over the shared key even while the fallback is on', () => {
    // During the rollout both are available. If the key won, signing in would
    // change nothing and every user would still see one org.
    const token = jwt({ sub: 'user-1' })
    const result = callerFromRequest(request({ authorization: `Bearer ${token}` }))

    expect(result).toEqual({ ok: true, caller: { kind: 'user', token, org: null } })
  })

  it('carries the requested org through', () => {
    const token = jwt({ sub: 'user-1' })
    const result = callerFromRequest(
      request({ authorization: `Bearer ${token}`, 'x-taskclan-org': 'org-uuid' })
    )

    expect(result).toMatchObject({ caller: { org: 'org-uuid' } })
  })

  it('ignores the legacy org header', () => {
    // The engine still accepts x-hivemind-org for sessions predating the
    // rename. This console has none, so honouring it only widens what a caller
    // can set.
    const token = jwt({ sub: 'user-1' })
    const result = callerFromRequest(
      request({ authorization: `Bearer ${token}`, 'x-hivemind-org': 'someone-elses-org' })
    )

    expect(result).toMatchObject({ caller: { org: null } })
  })

  it('falls back to the shared key when nobody is signed in', () => {
    const result = callerFromRequest(request())

    expect(result).toEqual({ ok: true, caller: { kind: 'shared', key: SHARED_KEY } })
  })

  it('says so in the log every time it falls back', () => {
    // Once auth is on, each of these is a request that should have carried a
    // user. The Worker log is the only place that is visible.
    callerFromRequest(request())

    expect(console.warn).toHaveBeenCalled()
  })

  it('fails closed once the fallback is switched off', () => {
    process.env.TASKCLAN_SHARED_KEY_FALLBACK = 'false'

    const result = callerFromRequest(request())

    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('reports missing configuration as 501 rather than 401', () => {
    // Not signed in and not configured are different problems with different
    // fixes, and the console already renders them differently.
    delete process.env.TASKCLAN_CLOUD_API_KEY

    expect(callerFromRequest(request())).toMatchObject({ ok: false, status: 501 })
  })
})

describe('authHeadersFor', () => {
  it('sends the org header only for a user', () => {
    const forUser = authHeadersFor({ kind: 'user', token: 't', org: 'org-1' })
    expect(forUser).toMatchObject({ authorization: 'Bearer t', 'x-taskclan-org': 'org-1' })

    // The key is the scope for a shared caller; the engine ignores the header
    // there, and sending it would imply it does something.
    const forShared = authHeadersFor({ kind: 'shared', key: SHARED_KEY })
    expect(forShared).not.toHaveProperty('x-taskclan-org')
  })
})

describe('cacheScopeFor', () => {
  it('keeps two users in different partitions', () => {
    const a = cacheScopeFor({ kind: 'user', token: jwt({ sub: 'user-a' }), org: null })
    const b = cacheScopeFor({ kind: 'user', token: jwt({ sub: 'user-b' }), org: null })

    expect(a).not.toEqual(b)
  })

  it('survives a token refresh', () => {
    // The access token rotates about hourly. Keying on the token itself would
    // empty the cache on every refresh, which is the reason the credential
    // cache exists at all.
    const before = cacheScopeFor({ kind: 'user', token: jwt({ sub: 'user-a', exp: 1 }), org: null })
    const after = cacheScopeFor({ kind: 'user', token: jwt({ sub: 'user-a', exp: 2 }), org: null })

    expect(before).toEqual(after)
  })

  it('separates one user\'s orgs', () => {
    const one = cacheScopeFor({ kind: 'user', token: jwt({ sub: 'user-a' }), org: 'org-1' })
    const two = cacheScopeFor({ kind: 'user', token: jwt({ sub: 'user-a' }), org: 'org-2' })

    expect(one).not.toEqual(two)
  })

  it('does not put the token in the key', () => {
    const token = jwt({ sub: 'user-a' })
    expect(cacheScopeFor({ kind: 'user', token, org: null })).not.toContain(token)
  })

  it('does not throw on a token it cannot read', () => {
    expect(() => cacheScopeFor({ kind: 'user', token: 'not-a-jwt', org: null })).not.toThrow()
  })
})
