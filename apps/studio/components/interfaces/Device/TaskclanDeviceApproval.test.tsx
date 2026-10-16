/**
 * Device approval, which is the highest-consequence click in this console:
 * it hands a machine a long-lived key to an organisation's apps, secrets and
 * credits.
 *
 * These tests are weighted to that rather than to layout. The one that matters
 * most is the first: a page that approved on load would turn this URL into a
 * link that grants access to whoever opens it.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskclanDeviceApproval } from './TaskclanDeviceApproval'
import { customRender } from '@/tests/lib/custom-render'

const paramsMock = vi.fn(() => ({ code: 'ABCD-1234' }) as Record<string, string>)
vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useParams: () => paramsMock(),
}))

const PENDING = {
  found: true,
  userCode: 'ABCD-1234',
  label: 'daniels-laptop',
  org: { id: 'org-1', name: "dnlamah1's workspace" },
  canApprove: true,
}

const cloud = (opts: { pending?: unknown; approve?: { ok: boolean; status: number; body: unknown } } = {}) =>
  vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      const r = opts.approve ?? { ok: true, status: 200, body: { ok: true, org: PENDING.org } }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => opts.pending ?? PENDING,
    } as unknown as Response
  })

const postCalls = (m: ReturnType<typeof cloud>) =>
  m.mock.calls.filter(([, i]) => (i as { method?: string } | undefined)?.method === 'POST')

afterEach(() => {
  vi.unstubAllGlobals()
  paramsMock.mockReturnValue({ code: 'ABCD-1234' })
})

describe('arriving from the CLI', () => {
  it('never approves just because the URL carried a code', async () => {
    // The whole reason approval is a separate click. If merely opening the page
    // granted access, the URL the CLI prints would be a transferable grant.
    const fetchMock = cloud()
    vi.stubGlobal('fetch', fetchMock)

    customRender(<TaskclanDeviceApproval />)
    await screen.findByText(/is asking to sign in/i)

    expect(postCalls(fetchMock)).toHaveLength(0)
  })

  it('looks the code up so the user sees what they are approving', async () => {
    // Reading is safe and saves retyping; only the grant is deliberate.
    vi.stubGlobal('fetch', cloud())
    customRender(<TaskclanDeviceApproval />)
    expect(await screen.findByText(/daniels-laptop/)).toBeInTheDocument()
  })

  it('names the organisation the key will be scoped to', async () => {
    // The engine binds the key to the caller's ACTIVE org, not to anything in
    // the request, so somebody with two orgs cannot otherwise tell which one
    // they just opened up.
    vi.stubGlobal('fetch', cloud())
    customRender(<TaskclanDeviceApproval />)
    expect(await screen.findByText(/grants access to dnlamah1's workspace/i)).toBeInTheDocument()
  })
})

describe('approving', () => {
  it('sends the approval only when the button is pressed', async () => {
    const fetchMock = cloud()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    customRender(<TaskclanDeviceApproval />)
    await user.click(await screen.findByRole('button', { name: /approve this device/i }))

    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    expect(await screen.findByText(/device approved/i)).toBeInTheDocument()
  })

  it('does not claim success when the approval failed', async () => {
    // The damaging version is silent: the screen says approved, the CLI keeps
    // polling, and the user waits at a terminal that will never finish.
    vi.stubGlobal(
      'fetch',
      cloud({ approve: { ok: false, status: 400, body: { error: 'that code has expired' } } })
    )
    const user = userEvent.setup()

    customRender(<TaskclanDeviceApproval />)
    await user.click(await screen.findByRole('button', { name: /approve this device/i }))

    expect(await screen.findByText(/that code has expired/i)).toBeInTheDocument()
    expect(screen.queryByText(/device approved/i)).not.toBeInTheDocument()
  })

  it("surfaces the engine's role refusal rather than a generic failure", async () => {
    vi.stubGlobal(
      'fetch',
      cloud({
        approve: { ok: false, status: 403, body: { error: 'your role cannot approve deploy access' } },
      })
    )
    const user = userEvent.setup()

    customRender(<TaskclanDeviceApproval />)
    await user.click(await screen.findByRole('button', { name: /approve this device/i }))

    expect(await screen.findByText(/role cannot approve deploy access/i)).toBeInTheDocument()
  })
})

describe('when the caller cannot approve', () => {
  it('disables the button and says who can', async () => {
    // Letting them click and collect a 403 is a worse version of the same
    // answer, and the useful half is "ask an owner or admin".
    vi.stubGlobal('fetch', cloud({ pending: { ...PENDING, canApprove: false } }))

    customRender(<TaskclanDeviceApproval />)

    expect(await screen.findByText(/your role cannot approve devices/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve this device/i })).toBeDisabled()
  })
})

describe('an unknown code', () => {
  it('says codes expire, rather than leaving a blank screen', async () => {
    paramsMock.mockReturnValue({ code: 'ZZZZ-9999' })
    vi.stubGlobal('fetch', cloud({ pending: { found: false } }))

    customRender(<TaskclanDeviceApproval />)

    expect(await screen.findByText(/no pending request for that code/i)).toBeInTheDocument()
  })
})
