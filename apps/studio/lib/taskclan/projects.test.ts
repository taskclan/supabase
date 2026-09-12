import { describe, expect, it } from 'vitest'

import {
  findSiteByRef,
  numericIdFor,
  studioStatusFor,
  toStudioProject,
  toStudioProjects,
  type CloudSite,
} from './projects'

/**
 * The Cloud -> Studio mapping.
 *
 * Everything here fails quietly if it is wrong, which is why it is tested: a
 * bad id renumbers apps and sends a saved link to the wrong one; a status that
 * defaults to healthy makes a failed deploy look fine in the dashboard.
 */

const site = (over: Partial<CloudSite> = {}): CloudSite => ({
  id: '15e5304f-77a8-40b1-8417-d80806b95f97',
  name: 'taskclan-engine',
  subdomain: 'taskclan-engine',
  status: 'active',
  type: 'service',
  region: 'weur',
  createdAt: '2026-08-01T10:00:00.000Z',
  deployStatus: 'ready',
  ...over,
})

describe('numericIdFor', () => {
  it('is stable for the same uuid', () => {
    // Studio persists the id in URLs and in "last visited project". If this
    // moved between requests, a saved link would open a different app.
    const a = numericIdFor('15e5304f-77a8-40b1-8417-d80806b95f97')
    expect(numericIdFor('15e5304f-77a8-40b1-8417-d80806b95f97')).toBe(a)
  })

  it('separates different uuids', () => {
    const ids = [
      '15e5304f-77a8-40b1-8417-d80806b95f97',
      '25e5304f-77a8-40b1-8417-d80806b95f97',
      'ce1a0dc9-b7f8-4142-ab56-cbf11bb8c9dd',
      '00000000-0000-0000-0000-000000000001',
    ].map(numericIdFor)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is a positive integer, and never 0', () => {
    // 0 reads as "unset" in too many places to be a safe id.
    for (const u of ['a', '', 'ce1a0dc9-b7f8-4142-ab56-cbf11bb8c9dd']) {
      const n = numericIdFor(u)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('does not depend on position in the list', () => {
    // A positional id would renumber every app whenever one is added or
    // deleted, which is the reason this is a hash at all.
    const a = site({ id: 'aaaaaaaa-0000-0000-0000-000000000001' })
    const b = site({ id: 'bbbbbbbb-0000-0000-0000-000000000002' })
    const first = toStudioProjects([a, b], 7).map((p) => p.id)
    const reordered = toStudioProjects([b, a], 7).map((p) => p.id)
    expect(reordered).toEqual([first[1], first[0]])
  })
})

describe('studioStatusFor', () => {
  it('maps a live app to healthy', () => {
    expect(studioStatusFor(site({ deployStatus: 'ready' }))).toBe('ACTIVE_HEALTHY')
    expect(studioStatusFor(site({ deployStatus: null, status: 'active' }))).toBe('ACTIVE_HEALTHY')
  })

  it('does NOT call an unknown status healthy — the one that matters', () => {
    // Studio disables the SQL editor and shows a banner for anything other
    // than ACTIVE_HEALTHY. Defaulting to healthy would make a broken app look
    // normal and let someone run a query against it.
    expect(studioStatusFor(site({ deployStatus: 'something-new' }))).toBe('UNKNOWN')
    expect(studioStatusFor(site({ deployStatus: null, status: null }))).toBe('UNKNOWN')
  })

  it('distinguishes building, failed and asleep', () => {
    expect(studioStatusFor(site({ deployStatus: 'building' }))).toBe('COMING_UP')
    expect(studioStatusFor(site({ deployStatus: 'error' }))).toBe('ACTIVE_UNHEALTHY')
    expect(studioStatusFor(site({ deployStatus: 'failed' }))).toBe('ACTIVE_UNHEALTHY')
    expect(studioStatusFor(site({ deployStatus: null, status: 'sleeping' }))).toBe('INACTIVE')
  })

  it('prefers the deploy status over the row status', () => {
    // A site row can say 'active' while its newest deploy is mid-build. The
    // deploy is the more current fact, and the one a person is waiting on.
    expect(studioStatusFor(site({ status: 'active', deployStatus: 'building' }))).toBe('COMING_UP')
  })

  it('is case-insensitive', () => {
    expect(studioStatusFor(site({ deployStatus: 'READY' }))).toBe('ACTIVE_HEALTHY')
  })
})

describe('toStudioProject', () => {
  it('carries the app across', () => {
    const p = toStudioProject(site(), 42)
    expect(p).toMatchObject({
      ref: 'taskclan-engine',
      name: 'taskclan-engine',
      organization_id: 42,
      cloud_provider: 'cloudflare',
      status: 'ACTIVE_HEALTHY',
      region: 'weur',
      inserted_at: '2026-08-01T10:00:00.000Z',
    })
  })

  it('uses the subdomain as the ref, falling back to the id', () => {
    // The subdomain is what the URL says everywhere else in Cloud. Falling
    // back to the id rather than '' keeps an app without one addressable —
    // two such apps would otherwise both route on the empty string.
    expect(toStudioProject(site({ subdomain: 'engine-dev' }), 1).ref).toBe('engine-dev')
    const noSub = toStudioProject(site({ subdomain: null }), 1)
    expect(noSub.ref).toBe('15e5304f-77a8-40b1-8417-d80806b95f97')
  })

  it('does not invent a region or a date', () => {
    const p = toStudioProject(site({ region: null, createdAt: null }), 1)
    expect(p.region).toBe('auto')
    expect(p.inserted_at).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe('findSiteByRef', () => {
  const a = site({ id: 'aaaa', subdomain: 'engine' })
  const b = site({ id: 'bbbb', subdomain: 'forge3d', name: 'forge3d' })

  it('finds by subdomain, and by id for a site without one', () => {
    expect(findSiteByRef([a, b], 'forge3d')?.id).toBe('bbbb')
    expect(findSiteByRef([a, b], 'bbbb')?.id).toBe('bbbb')
  })

  it('prefers a subdomain match over an id match', () => {
    // If one app's id happened to equal another's subdomain, the subdomain is
    // the identity Studio routes on and must win.
    const odd = site({ id: 'forge3d', subdomain: 'other', name: 'odd' })
    expect(findSiteByRef([odd, b], 'forge3d')?.name).toBe('forge3d')
  })

  it('returns null rather than the first app for an unknown ref', () => {
    // Returning [0] is what upstream effectively does, and it would open a
    // different app than the URL names.
    expect(findSiteByRef([a, b], 'deleted-app')).toBeNull()
    expect(findSiteByRef([], 'anything')).toBeNull()
  })
})
