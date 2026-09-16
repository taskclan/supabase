/**
 * The GitHub card on the Integrations page.
 *
 * It replaced one that could only fail: upstream's section talks to Supabase's
 * integrations API, which this build does not serve, so every state it showed
 * was wrong. These tests are mostly about not repeating that, which means the
 * failure states matter more than the happy one.
 */
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskclanGitHubSection } from './TaskclanGitHubSection'
import { customRender } from '@/tests/lib/custom-render'

const respond = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response)

afterEach(() => {
  vi.unstubAllGlobals()
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
