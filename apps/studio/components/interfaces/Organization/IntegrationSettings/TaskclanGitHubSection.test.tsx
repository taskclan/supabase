/**
 * The GitHub card on the Integrations page.
 *
 * It replaced one that could only fail: upstream's section talks to Supabase's
 * integrations API, which this build does not serve, so every state it showed
 * was wrong. These tests are mostly about not repeating that, which means the
 * failure states matter more than the happy one.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import mockRouter from 'next-router-mock'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskclanGitHubSection } from './TaskclanGitHubSection'
import { customRender } from '@/tests/lib/custom-render'

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))
vi.mock('sonner', () => ({ toast }))

const respond = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response)

const realLocation = window.location

afterEach(() => {
  vi.unstubAllGlobals()
  toast.success.mockClear()
  Object.defineProperty(window, 'location', {
    value: realLocation,
    writable: true,
    configurable: true,
  })
})

describe('TaskclanGitHubSection', () => {
  it('lists the accounts already connected to the organisation', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        installations: [{ installationId: 1, accountLogin: 'taskclan' }],
        repos: [{}, {}],
      })
    )

    customRender(<TaskclanGitHubSection />)

    expect(await screen.findByText('taskclan')).toBeInTheDocument()
  })

  it('says how many repositories the connection can actually deploy', async () => {
    // "Connected" on its own does not tell you whether the installation was
    // granted any repositories, which is the usual way this ends up not working.
    vi.stubGlobal(
      'fetch',
      respond({ installations: [{ installationId: 1, accountLogin: 'taskclan' }], repos: [{}, {}] })
    )

    customRender(<TaskclanGitHubSection />)

    expect(await screen.findByText('2 repositories available')).toBeInTheDocument()
  })

  it("sends each account's Configure to the page that manages it", async () => {
    // An organisation's installation lives under the organisation; the
    // person's own settings page does not have it.
    vi.stubGlobal(
      'fetch',
      respond({
        installations: [
          { installationId: 7, accountLogin: 'taskclan', accountType: 'Organization' },
          { installationId: 9, accountLogin: 'dnlamah1', accountType: 'User' },
        ],
        repos: [],
      })
    )

    customRender(<TaskclanGitHubSection />)

    await screen.findByText('taskclan')
    expect(
      screen.getAllByRole('link', { name: /configure/i }).map((a) => a.getAttribute('href'))
    ).toEqual([
      'https://github.com/organizations/taskclan/settings/installations/7',
      'https://github.com/settings/installations/9',
    ])
  })

  it('offers to connect when nothing is connected yet', async () => {
    vi.stubGlobal('fetch', respond({ installations: [], repos: [] }))

    customRender(<TaskclanGitHubSection />)

    expect(await screen.findByRole('button', { name: /connect github/i })).toBeInTheDocument()
  })

  it('says it could not load rather than showing an empty state', async () => {
    // The distinction the old section got wrong. "No connections" and "we could
    // not ask" look identical on screen and lead somewhere completely
    // different: one invites you to connect an account you may already have.
    vi.stubGlobal('fetch', respond({ error: 'could not reach the Cloud API' }, false, 502))

    customRender(<TaskclanGitHubSection />)

    await waitFor(() =>
      expect(screen.getByText(/could not load your github connections/i)).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /connect github/i })).not.toBeInTheDocument()
  })

  it('asks GitHub to send the person back to this page, not just this host', async () => {
    // With only the host, Cloud came back to a default page this console does
    // not have.
    const page = 'https://cloud.taskclan.com/org/acme/integrations'
    const location = { href: page, origin: 'https://cloud.taskclan.com' }
    Object.defineProperty(window, 'location', {
      value: location,
      writable: true,
      configurable: true,
    })
    const install = 'https://github.com/apps/taskclan-cloud/installations/new?state=x'
    const fetchMock = vi.fn(async (input: string) => {
      const body = input.startsWith('/api/taskclan/github/connect')
        ? { url: install }
        : { installations: [], repos: [] }
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    customRender(<TaskclanGitHubSection />)
    await userEvent.click(await screen.findByRole('button', { name: /connect github/i }))

    await waitFor(() => expect(location.href).toBe(install))
    const asked = fetchMock.mock.calls
      .map(([input]) => input)
      .find((input) => input.startsWith('/api/taskclan/github/connect'))
    expect(new URLSearchParams(asked?.split('?')[1]).get('returnTo')).toBe(page)
  })

  it('says how the install went when GitHub sends the person back', async () => {
    mockRouter.setCurrentUrl('/org/acme/integrations?git=connected')
    vi.stubGlobal(
      'fetch',
      respond({ installations: [{ installationId: 1, accountLogin: 'taskclan' }], repos: [{}] })
    )

    customRender(<TaskclanGitHubSection />)

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('GitHub connected', expect.anything())
    )
    expect(await screen.findByText('taskclan')).toBeInTheDocument()
    await waitFor(() => expect(mockRouter.asPath).toBe('/org/acme/integrations'))
  })

  it('does not claim anything while it is still loading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )

    customRender(<TaskclanGitHubSection />)

    expect(screen.queryByRole('button', { name: /connect github/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/repositories available/i)).not.toBeInTheDocument()
  })
})
