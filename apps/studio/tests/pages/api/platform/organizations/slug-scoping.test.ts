/**
 * /org/{slug} must show THAT org's apps.
 *
 * The route took the slug in its path and ignored it, answering with the
 * caller's active org instead. With one org that is indistinguishable from
 * correct, which is why it survived: the bug only appears when somebody belongs
 * to a second one, and then it lists Acme's apps under Globex's heading with
 * nothing on the page to say so.
 *
 * Stubs fetch rather than mocking the client module, so the org lookup, the
 * slug match and the org-scoped site listing are all really exercised.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../../pages/api/platform/organizations/[slug]/projects'

function tokenFor(sub: string): string {
  const body = Buffer.from(JSON.stringify({ sub }), 'utf8').toString('base64url')
  return `header.${body}.signature`
}

const ORGS = [
  { id: 'uuid-acme', name: 'Acme', slug: 'acme' },
  // Engine slug deliberately unlike the name, which is what a uniqueness loop
  // produces when two orgs share a name. The console used to derive "globex".
  { id: 'uuid-globex', name: 'Globex', slug: 'globex-2' },
]

/** Cloud, answering with whichever org the x-taskclan-org header selects. */
function cloud() {
  return vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    if (url.includes('/api/cloud/v1/orgs')) {
      return { ok: true, status: 200, json: async () => ({ activeOrgId: 'uuid-acme', orgs: ORGS }) }
    }
    const org = init.headers['x-taskclan-org']
    const byOrg: Record<string, unknown[]> = {
      'uuid-acme': [{ id: 's1', name: 'acme-app', subdomain: 'acme-app', orgId: 'uuid-acme' }],
      'uuid-globex': [{ id: 's2', name: 'globex-app', subdomain: 'globex-app', orgId: 'uuid-globex' }],
    }
    return { ok: true, status: 200, json: async () => ({ sites: byOrg[org] ?? [] }) }
  })
}

beforeEach(() => {
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = 'sk_cloud_' + 'a'.repeat(48)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const get = async (slug: string) => {
  const { req, res } = createMocks({
    method: 'GET',
    query: { slug },
    headers: { authorization: `Bearer ${tokenFor('user-a')}` },
  })
  await handler(req as never, res as never)
  return res
}

describe('GET /api/platform/organizations/[slug]/projects', () => {
  it('lists the apps of the org named in the path, not the active one', async () => {
    // "globex" is deliberately NOT the active org, which is what the old
    // behaviour would have returned.
    vi.stubGlobal('fetch', cloud())

    const body = (await get('globex-2'))._getJSONData()

    expect(body.projects.map((p: { ref: string }) => p.ref)).toEqual(['globex-app'])
  })

  it('still answers for the active org', async () => {
    vi.stubGlobal('fetch', cloud())

    const body = (await get('acme'))._getJSONData()

    expect(body.projects.map((p: { ref: string }) => p.ref)).toEqual(['acme-app'])
  })

  it('files each app under the org the path named', async () => {
    // Studio matches an app to an org by this number. Getting it from the
    // active org instead would render Globex's app under Acme.
    vi.stubGlobal('fetch', cloud())

    const acme = (await get('acme'))._getJSONData()
    const globex = (await get('globex-2'))._getJSONData()

    expect(acme.projects[0].organization_id).not.toBe(globex.projects[0].organization_id)
  })

  it('still resolves the slug this console used to derive from the name', async () => {
    // Org URLs and the stored "last visited organisation" hold the old derived
    // slug. Recognising only the engine's own would 404 every one of them the
    // first time somebody opens the console after the change, which looks like
    // having been removed from their organisation.
    vi.stubGlobal('fetch', cloud())

    // Globex's engine slug is "globex-2"; "globex" is what this console used to
    // compute, and is what old URLs still hold.
    const res = await get('globex')
    const body = res._getJSONData()

    expect(res._getStatusCode()).toBe(200)
    expect(body.projects.map((p: { ref: string }) => p.ref)).toEqual(['globex-app'])
  })

  it('is a 404 for an org the caller does not belong to', async () => {
    // Not an empty list. "You have no apps here" is a different and more
    // alarming claim than "there is no such organisation".
    vi.stubGlobal('fetch', cloud())

    expect((await get('someone-elses-org'))._getStatusCode()).toBe(404)
  })
})
