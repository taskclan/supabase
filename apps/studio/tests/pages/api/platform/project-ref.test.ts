/**
 * Opening an app that lives outside the caller's current workspace.
 *
 * The project page asks /platform/projects/{ref} with no organisation named,
 * and this route looked only in the current one: the first app in a second
 * workspace (aiya-logistics-web, 2026-10-09) answered 404 on every load. It
 * also labelled whatever it found with the current workspace's id, which would
 * file the project under the wrong organisation.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../../pages/api/platform/projects/[ref]'
import { taskclanOrgs } from '@/lib/taskclan/org'

const USER = { authorization: 'Bearer user-session-token' }
const ORGS = [
  { id: 'personal', name: 'Personal', slug: 'dan-s-workspace', plan: 'pro' },
  { id: 'aiya', name: 'Aiya', slug: 'aiya', plan: 'free' },
]
const SITES: Record<string, unknown[]> = {
  personal: [{ id: 's1', name: 'billing', subdomain: 'billing', orgId: 'personal', status: 'live', type: 'service' }],
  aiya: [{ id: 's2', name: 'aiya-logistics-web', subdomain: 'aiya-logistics-web', orgId: 'aiya', status: 'active', type: 'static' }],
}

function cloud() {
  return vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    if (url.endsWith('/api/cloud/v1/orgs')) {
      return { ok: true, status: 200, json: async () => ({ activeOrgId: 'personal', orgs: ORGS }) }
    }
    const org = init.headers['x-taskclan-org'] ?? 'personal'
    return { ok: true, status: 200, json: async () => ({ sites: SITES[org] ?? [] }) }
  })
}

const get = async (ref: string) => {
  const { req, res } = createMocks({ method: 'GET', query: { ref }, headers: USER })
  await handler(req as never, res as never)
  return res
}

beforeEach(() => {
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = 'sk_cloud_' + 'a'.repeat(48)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', cloud())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('GET /api/platform/projects/[ref]', () => {
  it('opens an app in another of your workspaces, filed under that workspace', async () => {
    const res = await get('aiya-logistics-web')

    expect(res._getStatusCode()).toBe(200)
    const project = res._getJSONData()
    expect(project).toMatchObject({ ref: 'aiya-logistics-web', name: 'aiya-logistics-web' })
    const orgs = await taskclanOrgs({ kind: 'user', token: 'user-session-token', org: null })
    const aiya = orgs.ok ? orgs.data.orgs.find((o) => o.slug === 'aiya') : undefined
    expect(project.organization_id).toBe(aiya?.id)
  })

  it('still opens an app in the current workspace', async () => {
    const res = await get('billing')
    expect(res._getStatusCode()).toBe(200)
    expect(res._getJSONData().ref).toBe('billing')
  })

  it("answers 404 for an app in none of your workspaces", async () => {
    expect((await get('someone-elses-app'))._getStatusCode()).toBe(404)
  })
})
