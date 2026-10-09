/**
 * The routes behind the Deployments page's "Connect a repository".
 *
 * The app in these tests lives in the caller's SECOND workspace, because that is
 * the case the panel exists for and the one that broke before: a project page
 * names no workspace (or the last one visited), so a route that asked Cloud
 * about "this workspace" got the wrong one's GitHub accounts and repositories.
 * Every Cloud call made on the app's behalf has to carry the app's own.
 */
import { createMocks } from 'node-mocks-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deployFromRepoHandler from '../../../../pages/api/taskclan/[ref]/deploy-from-repo'
import gitHandler from '../../../../pages/api/taskclan/[ref]/git'
import connectHandler from '../../../../pages/api/taskclan/github/connect'

function tokenFor(sub: string): string {
  const body = Buffer.from(JSON.stringify({ sub, email: `${sub}@example.com` }), 'utf8').toString(
    'base64url'
  )
  return `header.${body}.signature`
}

const ENV = [
  'TASKCLAN_CLOUD_URL',
  'TASKCLAN_CLOUD_API_KEY',
  'TASKCLAN_SHARED_KEY_FALLBACK',
] as const
let saved: Record<string, string | undefined> = {}

interface Call {
  method: string
  path: string
  org: string | null
  body: unknown
}
type Reply = { status?: number; body: unknown }
type Routes = Record<string, (call: Call) => Reply>

const HOME = 'org-home'
const AIYA = 'org-aiya'

/**
 * Cloud with two workspaces. The caller is active in HOME, which has no apps;
 * the app is in AIYA, and only a request naming AIYA can list it.
 */
function cloud(routes: Routes, site: { type: 'static' | 'service' } = { type: 'static' }) {
  const calls: Call[] = []
  const all: Routes = {
    'GET /api/cloud/v1/sites': (c) => ({
      body: {
        sites:
          c.org === AIYA
            ? [{ id: 'site-aiya', name: 'aiya-app', subdomain: 'aiya-app', orgId: AIYA, ...site }]
            : [],
      },
    }),
    'GET /api/cloud/v1/orgs': () => ({
      body: {
        orgs: [
          { id: HOME, name: 'Home' },
          { id: AIYA, name: 'Aiya' },
        ],
        activeOrgId: HOME,
      },
    }),
    ...routes,
  }
  const fetchMock = vi.fn(
    async (
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: string } = {}
    ) => {
      const call: Call = {
        method: init.method ?? 'GET',
        path: new URL(url).pathname,
        org: init.headers?.['x-taskclan-org'] ?? null,
        body: init.body ? JSON.parse(init.body) : undefined,
      }
      calls.push(call)
      const route = all[`${call.method} ${call.path}`]
      const reply: Reply = route
        ? route(call)
        : { status: 404, body: { error: `no fake for ${call.method} ${call.path}` } }
      const status = reply.status ?? 200
      return { ok: status < 400, status, json: async () => reply.body }
    }
  )
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

/** Calls other than the two that find the app. */
const onBehalf = (calls: Call[]) =>
  calls.filter(
    (c) => !(c.method === 'GET' && ['/api/cloud/v1/sites', '/api/cloud/v1/orgs'].includes(c.path))
  )

const call = async (
  handler: (req: never, res: never) => unknown,
  {
    method = 'GET',
    query,
    body,
  }: { method?: string; query: Record<string, string>; body?: unknown }
) => {
  const { req, res } = createMocks({
    method: method as 'GET' | 'POST',
    query,
    body: body as Record<string, unknown>,
    headers: { authorization: `Bearer ${tokenFor('user-a')}` },
  })
  await handler(req as never, res as never)
  return { status: res._getStatusCode(), body: res._getJSONData() }
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

const TASKCLAN = { installationId: 7, accountLogin: 'taskclan', accountType: 'Organization' }

describe('GET /api/taskclan/{ref}/git', () => {
  it("answers from the app's own workspace", async () => {
    const calls = cloud({
      'GET /api/cloud/v1/sites/site-aiya/git': () => ({ body: { git: null } }),
      'GET /api/cloud/v1/git/installations': () => ({
        body: { installations: [], available: [{ ...TASKCLAN, connectedBy: 'user-a' }] },
      }),
      'GET /api/cloud/v1/git/repos': () => ({ body: { installations: [], repos: [] } }),
    })

    const res = await call(gitHandler, { query: { ref: 'aiya-app' } })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      type: 'static',
      link: null,
      installations: [],
      available: [TASKCLAN],
      repos: [],
    })
    const asked = onBehalf(calls)
    expect(asked.map((c) => c.path).sort()).toEqual([
      '/api/cloud/v1/git/installations',
      '/api/cloud/v1/git/repos',
      '/api/cloud/v1/sites/site-aiya/git',
    ])
    expect(asked.every((c) => c.org === AIYA)).toBe(true)
  })

  it('reports the link, and only the repository fields the panel reads', async () => {
    cloud(
      {
        'GET /api/cloud/v1/sites/site-aiya/git': () => ({
          body: {
            git: { repoFullName: 'taskclan/taskclan-aiya-web', branch: 'main', installationId: 7 },
          },
        }),
        'GET /api/cloud/v1/git/installations': () => ({
          body: { installations: [{ ...TASKCLAN, orgId: AIYA }], available: [] },
        }),
        'GET /api/cloud/v1/git/repos': () => ({
          body: {
            repos: [
              {
                fullName: 'taskclan/taskclan-aiya-web',
                defaultBranch: 'main',
                private: true,
                installationId: 7,
                updatedAt: '2026-10-09T00:00:00Z',
                language: 'TypeScript',
                owner: 'taskclan',
              },
            ],
          },
        }),
      },
      { type: 'service' }
    )

    const res = await call(gitHandler, { query: { ref: 'aiya-app' } })

    expect(res.status).toBe(200)
    expect(res.body.type).toBe('service')
    expect(res.body.link).toEqual({ repo: 'taskclan/taskclan-aiya-web', branch: 'main' })
    expect(res.body.installations).toEqual([TASKCLAN])
    expect(res.body.repos).toEqual([
      {
        fullName: 'taskclan/taskclan-aiya-web',
        defaultBranch: 'main',
        private: true,
        installationId: 7,
      },
    ])
  })

  it("passes Cloud's refusal through rather than an empty list", async () => {
    // An empty list would read as "no GitHub account here" and offer to install
    // one, when the real answer was that this person may not look.
    cloud({
      'GET /api/cloud/v1/sites/site-aiya/git': () => ({ body: { git: null } }),
      'GET /api/cloud/v1/git/installations': () => ({
        status: 403,
        body: { error: 'not your workspace' },
      }),
      'GET /api/cloud/v1/git/repos': () => ({ body: { repos: [] } }),
    })

    const res = await call(gitHandler, { query: { ref: 'aiya-app' } })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'not your workspace' })
  })

  it('is 404 for an app the caller cannot see, and asks Cloud nothing about it', async () => {
    const calls = cloud({})

    const res = await call(gitHandler, { query: { ref: 'someone-elses-app' } })

    expect(res.status).toBe(404)
    expect(onBehalf(calls)).toEqual([])
  })
})

describe('POST /api/taskclan/{ref}/git', () => {
  it("connects the account in the app's workspace", async () => {
    const calls = cloud({
      'POST /api/cloud/v1/git/installations': (c) => ({
        body: {
          ok: true,
          installationId: (c.body as { installationId: number }).installationId,
          accountLogin: 'taskclan',
        },
      }),
    })

    const res = await call(gitHandler, {
      method: 'POST',
      query: { ref: 'aiya-app' },
      body: { installationId: 7 },
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, installationId: 7, accountLogin: 'taskclan' })
    expect(onBehalf(calls)).toEqual([
      {
        method: 'POST',
        path: '/api/cloud/v1/git/installations',
        org: AIYA,
        body: { installationId: 7 },
      },
    ])
  })

  it('refuses a request without an installation before calling Cloud', async () => {
    const calls = cloud({})

    const res = await call(gitHandler, { method: 'POST', query: { ref: 'aiya-app' }, body: {} })

    expect(res.status).toBe(400)
    expect(onBehalf(calls)).toEqual([])
  })
})

describe('GET /api/taskclan/github/connect', () => {
  it("started from an app, installs into the app's workspace", async () => {
    // Cloud binds the new installation to whichever workspace asks for the URL.
    const calls = cloud({
      'GET /api/cloud/v1/git/connect': () => ({
        body: { url: 'https://github.com/apps/taskclan-cloud/installations/new?state=x' },
      }),
    })

    const res = await call(connectHandler, { query: { ref: 'aiya-app' } })

    expect(res.status).toBe(200)
    expect(res.body.url).toContain('github.com/apps/taskclan-cloud')
    expect(onBehalf(calls)).toEqual([
      expect.objectContaining({ path: '/api/cloud/v1/git/connect', org: AIYA }),
    ])
  })

  it('without an app, asks as the caller and looks nothing up', async () => {
    const calls = cloud({
      'GET /api/cloud/v1/git/connect': () => ({
        body: { url: 'https://github.com/apps/taskclan-cloud/installations/new?state=x' },
      }),
    })

    const res = await call(connectHandler, { query: {} })

    expect(res.status).toBe(200)
    expect(calls).toEqual([
      expect.objectContaining({ path: '/api/cloud/v1/git/connect', org: null }),
    ])
  })

  it('is 404 for an app the caller cannot see', async () => {
    const calls = cloud({})

    const res = await call(connectHandler, { query: { ref: 'someone-elses-app' } })

    expect(res.status).toBe(404)
    expect(onBehalf(calls)).toEqual([])
  })
})

describe('POST /api/taskclan/{ref}/deploy-from-repo', () => {
  const REPO = { repo: 'taskclan/taskclan-aiya-web', branch: 'main', installationId: 7 }

  it('links a static app to its repository and deploys it with the installation', async () => {
    // `deploy { repo }` fetched the repo without a token and saved no link: a
    // private repo failed, and a public one left the app still unlinked.
    const calls = cloud({
      'POST /api/cloud/v1/sites/site-aiya/git': () => ({
        status: 201,
        body: {
          connected: true,
          repo: REPO.repo,
          branch: 'main',
          url: 'https://aiya-app.pages.dev',
        },
      }),
    })

    const res = await call(deployFromRepoHandler, {
      method: 'POST',
      query: { ref: 'aiya-app' },
      body: { ...REPO, type: 'static' },
    })

    expect(res.status).toBe(202)
    expect(onBehalf(calls)).toEqual([
      { method: 'POST', path: '/api/cloud/v1/sites/site-aiya/git', org: null, body: REPO },
    ])
  })

  it('refuses to deploy a web service as a static site', async () => {
    // Cloud's git route deploys by the app's own type, so this would have
    // quietly built a server instead.
    const calls = cloud({}, { type: 'service' })

    const res = await call(deployFromRepoHandler, {
      method: 'POST',
      query: { ref: 'aiya-app' },
      body: { ...REPO, type: 'static' },
    })

    expect(res.status).toBe(409)
    expect(onBehalf(calls)).toEqual([])
  })

  it('builds a server from the repository, branch and installation', async () => {
    const calls = cloud({
      'POST /api/cloud/v1/sites/site-aiya/deploy-service': () => ({
        status: 202,
        body: { deploymentId: 'dep-1' },
      }),
    })

    const res = await call(deployFromRepoHandler, {
      method: 'POST',
      query: { ref: 'aiya-app' },
      body: REPO,
    })

    expect(res.status).toBe(202)
    expect(onBehalf(calls)).toEqual([
      {
        method: 'POST',
        path: '/api/cloud/v1/sites/site-aiya/deploy-service',
        org: null,
        body: {
          repo: REPO.repo,
          ref: 'main',
          installationId: 7,
          autoscale: false,
          maxInstances: 1,
        },
      },
    ])
  })
})
