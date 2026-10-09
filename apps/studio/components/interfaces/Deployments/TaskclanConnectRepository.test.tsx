/**
 * "Connect a repository" on an app's Deployments page.
 *
 * What it has to get right is what each state lets a person do next: an app
 * already linked shows nothing; a workspace with no GitHub account offers the
 * install; an account held in another workspace is one click away; and once a
 * repository is chosen, the build is asked for the way the app actually runs.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  githubAccessUrl,
  TaskclanConnectRepository,
  type GitState,
} from './TaskclanConnectRepository'
import { customRender } from '@/tests/lib/custom-render'

const TASKCLAN = { installationId: 7, accountLogin: 'taskclan', accountType: 'Organization' }
const AIYA_REPO = {
  fullName: 'taskclan/taskclan-aiya-web',
  defaultBranch: 'main',
  private: true,
  installationId: 7,
}

const state = (over: Partial<GitState> = {}): GitState => ({
  type: 'static',
  link: null,
  installations: [],
  available: [],
  repos: [],
  ...over,
})

interface Sent {
  method: string
  path: string
  body: unknown
}

/**
 * The console API. GET {ref}/git answers `before` until the panel writes
 * something, then `after`, so a reload after an action sees what it changed.
 */
function consoleApi(
  { before, after = before }: { before: GitState; after?: GitState },
  replies: Record<string, { status?: number; body: unknown }> = {}
) {
  const sent: Sent[] = []
  let wrote = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost')
      const method = init.method ?? 'GET'
      sent.push({
        method,
        path: url.pathname + url.search,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      if (method !== 'GET') wrote = true
      if (method === 'GET' && url.pathname === '/api/taskclan/aiya-app/git') {
        const body = wrote ? after : before
        return { ok: true, status: 200, json: async () => body } as unknown as Response
      }
      const reply = replies[`${method} ${url.pathname}`] ?? {
        status: 404,
        body: { error: 'unexpected' },
      }
      const status = reply.status ?? 200
      return { ok: status < 400, status, json: async () => reply.body } as unknown as Response
    })
  )
  return sent
}

const writes = (sent: Sent[]) => sent.filter((s) => s.method !== 'GET')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TaskclanConnectRepository', () => {
  it('shows nothing for an app that already builds from a repository', async () => {
    consoleApi({ before: state({ link: { repo: AIYA_REPO.fullName, branch: 'main' } }) })
    const onLinkedChange = vi.fn()

    customRender(
      <TaskclanConnectRepository
        projectRef="aiya-app"
        onLinkedChange={onLinkedChange}
        onDeploy={vi.fn()}
      />
    )

    await waitFor(() => expect(onLinkedChange).toHaveBeenCalledWith(true))
    expect(screen.queryByRole('region', { name: 'Connect a repository' })).not.toBeInTheDocument()
  })

  it('offers the GitHub install when the workspace has no account, in a new tab', async () => {
    const sent = consoleApi(
      { before: state() },
      {
        'GET /api/taskclan/github/connect': {
          body: { url: 'https://github.com/apps/taskclan-cloud/installations/new?state=x' },
        },
      }
    )
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const onLinkedChange = vi.fn()

    customRender(
      <TaskclanConnectRepository
        projectRef="aiya-app"
        onLinkedChange={onLinkedChange}
        onDeploy={vi.fn()}
      />
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Install on GitHub' }))

    await waitFor(() =>
      expect(tab.location.href).toBe(
        'https://github.com/apps/taskclan-cloud/installations/new?state=x'
      )
    )
    expect(tab.opener).toBeNull()
    expect(onLinkedChange).toHaveBeenCalledWith(false)
    // The installation has to land in the app's workspace, which only the ref names.
    expect(sent.some((s) => s.path === '/api/taskclan/github/connect?ref=aiya-app')).toBe(true)
    // Coming back from GitHub is the cue to look again.
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeInTheDocument()
  })

  it('brings an account from another workspace in with one click, then lists its repositories', async () => {
    const sent = consoleApi(
      {
        before: state({ available: [TASKCLAN] }),
        after: state({ installations: [TASKCLAN], repos: [AIYA_REPO] }),
      },
      { 'POST /api/taskclan/aiya-app/git': { body: { ok: true, installationId: 7 } } }
    )

    customRender(<TaskclanConnectRepository projectRef="aiya-app" onDeploy={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Use taskclan here' }))

    expect(await screen.findByRole('combobox', { name: 'Repository' })).toBeInTheDocument()
    expect(writes(sent)).toEqual([
      { method: 'POST', path: '/api/taskclan/aiya-app/git', body: { installationId: 7 } },
    ])
  })

  it('links and deploys a static app as static files, then gets out of the way', async () => {
    const sent = consoleApi(
      {
        before: state({ installations: [TASKCLAN], repos: [AIYA_REPO] }),
        after: state({
          installations: [TASKCLAN],
          repos: [AIYA_REPO],
          link: { repo: AIYA_REPO.fullName, branch: 'main' },
        }),
      },
      { 'POST /api/taskclan/aiya-app/deploy-from-repo': { status: 202, body: { connected: true } } }
    )
    const onDeploy = vi.fn()
    const onLinkedChange = vi.fn()
    const user = userEvent.setup()

    customRender(
      <TaskclanConnectRepository
        projectRef="aiya-app"
        onLinkedChange={onLinkedChange}
        onDeploy={onDeploy}
      />
    )
    await user.click(await screen.findByRole('combobox', { name: 'Repository' }))
    await user.click(await screen.findByRole('option', { name: /taskclan\/taskclan-aiya-web/ }))

    // The branch starts at the repository's default, and the app's own type is the default.
    expect(screen.getByLabelText('Branch')).toHaveValue('main')
    expect(screen.getByRole('combobox', { name: 'Run it as' })).toHaveTextContent('Static files')

    await user.click(screen.getByRole('button', { name: 'Connect and deploy' }))

    await waitFor(() => expect(onLinkedChange).toHaveBeenLastCalledWith(true))
    expect(onDeploy).toHaveBeenCalledTimes(1)
    expect(writes(sent)).toEqual([
      {
        method: 'POST',
        path: '/api/taskclan/aiya-app/deploy-from-repo',
        body: { repo: AIYA_REPO.fullName, branch: 'main', installationId: 7, type: 'static' },
      },
    ])
    expect(screen.queryByRole('region', { name: 'Connect a repository' })).not.toBeInTheDocument()
  })

  it('lets a static app switch to a server', async () => {
    const sent = consoleApi(
      { before: state({ installations: [TASKCLAN], repos: [AIYA_REPO] }) },
      {
        'POST /api/taskclan/aiya-app/deploy-from-repo': { status: 202, body: {} },
      }
    )
    const user = userEvent.setup()

    customRender(<TaskclanConnectRepository projectRef="aiya-app" onDeploy={vi.fn()} />)
    await user.click(await screen.findByRole('combobox', { name: 'Repository' }))
    await user.click(await screen.findByRole('option', { name: /taskclan\/taskclan-aiya-web/ }))
    await user.click(screen.getByRole('combobox', { name: 'Run it as' }))
    await user.click(await screen.findByRole('option', { name: 'A server' }))
    await user.click(screen.getByRole('button', { name: 'Connect and deploy' }))

    await waitFor(() => expect(writes(sent)).toHaveLength(1))
    expect(writes(sent)[0].body).toEqual({
      repo: AIYA_REPO.fullName,
      branch: 'main',
      installationId: 7,
    })
  })

  it('does not offer static files to an app that runs as a server', async () => {
    // A server has no way back to static files, so asking would only offer a refusal.
    consoleApi({
      before: state({ type: 'service', installations: [TASKCLAN], repos: [AIYA_REPO] }),
    })
    const user = userEvent.setup()

    customRender(<TaskclanConnectRepository projectRef="aiya-app" onDeploy={vi.fn()} />)
    await user.click(await screen.findByRole('combobox', { name: 'Repository' }))
    await user.click(await screen.findByRole('option', { name: /taskclan\/taskclan-aiya-web/ }))

    expect(screen.getByRole('button', { name: 'Connect and deploy' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Run it as' })).not.toBeInTheDocument()
  })

  it("points each account's repository access at the right GitHub settings page", () => {
    expect(githubAccessUrl(TASKCLAN)).toBe(
      'https://github.com/organizations/taskclan/settings/installations/7'
    )
    expect(
      githubAccessUrl({ installationId: 9, accountLogin: 'dnlamah1', accountType: 'User' })
    ).toBe('https://github.com/settings/installations/9')
  })
})
