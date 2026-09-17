/**
 * The release queue, weighted to the three answers that would mislead someone
 * into thinking code shipped when it did not.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskclanReleases } from './TaskclanReleases'
import { customRender } from '@/tests/lib/custom-render'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
const { toast } = await import('sonner')

const HELD = {
  id: 'i1',
  ref: 'DI-4618',
  siteId: 'site-1',
  status: 'awaiting_approval',
  commitSha: '261a0d6f4c38cef13531e5b90ee1cd068ae79352',
  commitMessage: 'studio3d: fix the jump prompt',
  riskScore: 0.15,
  riskFactors: [{ code: 'rollback_history', label: '5 of the last 12 releases were rolled back' }],
  policyEval: [
    { rule: 'production.autonomy_level', title: 'Autonomous', verdict: 'satisfied' },
    {
      rule: 'release.deploy_mode.manual',
      title: 'This app deploys manually',
      detail: 'Set to manual, so a push opens a release and waits rather than building.',
      verdict: 'needs_human',
    },
  ],
  approvals: [],
}

const cloud = (opts: { intents?: unknown[]; post?: { ok: boolean; status: number; body: unknown } } = {}) =>
  vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      const r = opts.post ?? { ok: true, status: 200, body: { ok: true, status: 'executing' } }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        intents: opts.intents ?? [HELD],
        siteNames: { 'site-1': 'taskclan-engine-studio-agent' },
      }),
    } as unknown as Response
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('the queue', () => {
  it('shows a held release and says why it is held', async () => {
    // "Held for approval" with no reason is what makes people distrust a gate.
    vi.stubGlobal('fetch', cloud())
    customRender(<TaskclanReleases />)

    expect(await screen.findByText(/DI-4618/)).toBeInTheDocument()
    expect(screen.getByText(/This app deploys manually/)).toBeInTheDocument()
    expect(screen.getByText(/Waiting for approval/)).toBeInTheDocument()
  })

  it('surfaces the risk factor rather than only a number', async () => {
    vi.stubGlobal('fetch', cloud())
    customRender(<TaskclanReleases />)
    expect(await screen.findByText(/5 of the last 12 releases were rolled back/)).toBeInTheDocument()
  })

  it('offers no decision on something already decided', async () => {
    // The engine 409s with "there is nothing to decide", so a button here is a
    // button that only produces errors.
    vi.stubGlobal('fetch', cloud({ intents: [{ ...HELD, status: 'superseded' }] }))
    customRender(<TaskclanReleases />)

    await screen.findByText(/DI-4618/)
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument()
  })
})

describe('approving', () => {
  it('reports a release only once the build has actually started', async () => {
    const fetchMock = cloud()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    customRender(<TaskclanReleases />)
    await user.click(await screen.findByRole('button', { name: /^approve/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/released/i)))
  })

  it('does not say released when a second signature is still outstanding', async () => {
    // The engine returns 200 with status awaiting_approval on the first of two
    // signatures. Calling that "released" walks somebody away from a release
    // that has not started.
    vi.stubGlobal(
      'fetch',
      cloud({ post: { ok: true, status: 200, body: { ok: true, status: 'awaiting_approval', approvals: 1, required: 2 } } })
    )
    const user = userEvent.setup()

    customRender(<TaskclanReleases />)
    await user.click(await screen.findByRole('button', { name: /^approve/i }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/still waiting on one more/i))
    )
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/released/i))
  })

  it('reports an approval whose build failed to start as a failure', async () => {
    // The worst case available: the grant is spent, nothing is deploying, and
    // the approval cannot be given again. Silence here strands the release.
    vi.stubGlobal(
      'fetch',
      cloud({ post: { ok: false, status: 502, body: { ok: false, status: 'approved', error: 'builder dispatch failed' } } })
    )
    const user = userEvent.setup()

    customRender(<TaskclanReleases />)
    await user.click(await screen.findByRole('button', { name: /^approve/i }))

    // Asserts the wording, not merely that an error fired: the generic refusal
    // path also fires toast.error, and it says only "builder dispatch failed",
    // which reads as "nothing happened". The point of this case is that
    // something DID happen and cannot be repeated.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/was approved, but the build did not start/i))
    )
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/needs a new deploy rather than another approval/i))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("passes the engine's refusal through instead of a generic failure", async () => {
    vi.stubGlobal(
      'fetch',
      cloud({ post: { ok: false, status: 409, body: { error: 'you have already approved this intent' } } })
    )
    const user = userEvent.setup()

    customRender(<TaskclanReleases />)
    await user.click(await screen.findByRole('button', { name: /^approve/i }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already approved/i))
    )
  })
})
