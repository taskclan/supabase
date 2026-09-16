import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Caller } from './callerContext'
import { assignNumericIds, taskclanOrg, taskclanOrgs } from './org'
import { numericIdFor } from './projects'

/**
 * Organisation resolution, which is where a tenancy bug renders rather than throws.
 *
 * The cache these tests replaced returned the first caller's org to every
 * caller afterwards. It was correct while one `sk_cloud_*` key was the only way
 * in, and became a cross-tenant read the moment two people could sign in. The
 * first test here is the one that would have caught it.
 */

/** A real FNV-1a collision: both fold to 4139948507. Found by search, not chosen. */
const COLLIDING = ['org-71xq', 'org-1xbea'] as const

const userA: Caller = { kind: 'user', token: 'token-a', org: null }
const userB: Caller = { kind: 'user', token: 'token-b', org: null }

function respondPerToken(byToken: Record<string, unknown>) {
  return vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
    const token = init.headers.authorization.replace('Bearer ', '')
    return { ok: true, status: 200, json: async () => byToken[token] }
  })
}

beforeEach(() => {
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('taskclanOrgs', () => {
  it('answers each caller with their own org, not the first caller cached', async () => {
    vi.stubGlobal(
      'fetch',
      respondPerToken({
        'token-a': { activeOrgId: 'org-a', orgs: [{ id: 'org-a', name: 'Acme', slug: 'acme' }] },
        'token-b': { activeOrgId: 'org-b', orgs: [{ id: 'org-b', name: 'Globex', slug: 'globex' }] },
      })
    )

    const first = await taskclanOrg(userA)
    const second = await taskclanOrg(userB)

    expect(first).toMatchObject({ ok: true, data: { uuid: 'org-a', name: 'Acme' } })
    expect(second).toMatchObject({ ok: true, data: { uuid: 'org-b', name: 'Globex' } })
  })

  it('asks Cloud every time rather than reusing an answer across callers', async () => {
    const fetchMock = respondPerToken({
      'token-a': { activeOrgId: 'org-a', orgs: [{ id: 'org-a', name: 'Acme', slug: 'acme' }] },
      'token-b': { activeOrgId: 'org-b', orgs: [{ id: 'org-b', name: 'Globex', slug: 'globex' }] },
    })
    vi.stubGlobal('fetch', fetchMock)

    await taskclanOrg(userA)
    await taskclanOrg(userB)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the slug the engine sent rather than deriving one from the name', async () => {
    // Two orgs can share a display name. The engine generates its slug with a
    // uniqueness loop; deriving one here would collide, and Studio routes org
    // URLs on the slug.
    vi.stubGlobal(
      'fetch',
      respondPerToken({
        'token-a': {
          activeOrgId: 'org-1',
          orgs: [
            { id: 'org-1', name: 'Acme', slug: 'acme' },
            { id: 'org-2', name: 'Acme', slug: 'acme-2' },
          ],
        },
      })
    )

    const result = await taskclanOrgs(userA)

    expect((result as { data: { orgs: Array<{ slug: string }> } }).data.orgs.map((o) => o.slug)).toEqual([
      'acme',
      'acme-2',
    ])
  })

  it('reports having no org rather than inventing a placeholder', async () => {
    vi.stubGlobal('fetch', respondPerToken({ 'token-a': { orgs: [] } }))

    expect(await taskclanOrg(userA)).toMatchObject({ ok: false })
  })
})

describe('assignNumericIds', () => {
  it('gives each org the plain hash when nothing collides', () => {
    const ids = assignNumericIds([
      { id: 'org-a', name: 'A' },
      { id: 'org-b', name: 'B' },
    ])

    expect(ids.get('org-a')).toBe(numericIdFor('org-a'))
    expect(ids.get('org-b')).toBe(numericIdFor('org-b'))
  })

  it('never gives two orgs the same id', () => {
    // Studio decides which apps belong to which org by comparing these numbers,
    // so a collision silently files one tenant's apps under another tenant.
    //
    // These two ids are a real collision, found by search rather than invented:
    // both fold to 4139948507 under numericIdFor. Random uuids would not
    // collide, so a test using them would pass whether or not this function
    // handled the case at all.
    expect(numericIdFor(COLLIDING[0])).toBe(numericIdFor(COLLIDING[1]))

    const ids = assignNumericIds([
      { id: COLLIDING[0], name: 'Acme' },
      { id: COLLIDING[1], name: 'Globex' },
    ])

    expect(ids.get(COLLIDING[0])).not.toBe(ids.get(COLLIDING[1]))
    expect(new Set(ids.values()).size).toBe(2)
  })

  it('leaves the first of a colliding pair on its natural id', () => {
    // Only the org that actually clashes moves. Rehashing both would change an
    // id that had no need to change.
    const ids = assignNumericIds([
      { id: COLLIDING[0], name: 'Acme' },
      { id: COLLIDING[1], name: 'Globex' },
    ])

    expect(ids.get(COLLIDING[0])).toBe(numericIdFor(COLLIDING[0]))
  })

  it('keeps an id stable as unrelated orgs are added', () => {
    // Resolved by rehashing rather than by taking the next free integer, so an
    // id does not shift when the list grows.
    const before = assignNumericIds([{ id: 'org-a', name: 'A' }])
    const after = assignNumericIds([
      { id: 'org-a', name: 'A' },
      { id: 'org-z', name: 'Z' },
    ])

    expect(after.get('org-a')).toBe(before.get('org-a'))
  })
})
