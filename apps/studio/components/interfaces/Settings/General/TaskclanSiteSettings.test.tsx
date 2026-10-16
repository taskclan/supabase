/**
 * The app's identity panel and its delete.
 *
 * The tests here weight the destructive path, and specifically the states where
 * the UI could tell someone a comforting untruth: that a failed delete
 * succeeded, or that an app which is merely unreachable has been deleted.
 * Deleting is the one action in this console with no undo, so "it said it
 * worked" has to mean it worked.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskclanSiteSettings } from './TaskclanSiteSettings'
import { customRender } from '@/tests/lib/custom-render'

const SITE = {
  id: 'site-a',
  name: 'express-demo',
  subdomain: 'express-demo',
  host: 'express-demo.cloud.taskclan.com',
  customDomain: null,
  status: 'ready',
  type: 'service',
  region: null,
  createdAt: '2026-04-02T10:00:00.000Z',
  liveUrl: 'https://express-demo.cloud.taskclan.com',
}

const errorToast = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => errorToast(...a), success: vi.fn(), info: vi.fn() },
}))

const pushMock = vi.fn()
vi.mock('next/router', () => ({
  useRouter: () => ({ push: pushMock, query: { ref: 'express-demo' }, isReady: true }),
}))
vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useParams: () => ({ ref: 'express-demo' }),
}))

/** Cloud answering the GET, then the DELETE with whatever the test wants. */
const cloud = (deleteResult?: { ok: boolean; status: number; body: unknown }) =>
  vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'DELETE') {
      const r = deleteResult ?? { ok: true, status: 200, body: { ok: true } }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({ site: SITE }) } as unknown as Response
  })

afterEach(() => {
  vi.unstubAllGlobals()
  pushMock.mockReset()
  errorToast.mockReset()
})

/**
 * Open the modal and type a phrase, returning the confirm button.
 *
 * The button is gated on react-hook-form's `isValid`, which the zod resolver
 * settles asynchronously — so callers wait for it to enable rather than
 * clicking straight after typing.
 */
async function openAndType(user: ReturnType<typeof userEvent.setup>, phrase: string) {
  await user.click(await screen.findByRole('button', { name: /delete app/i }))
  const input = await screen.findByPlaceholderText(/type the app name/i)
  await user.type(input, phrase)
  return screen.getByRole('button', { name: /i understand, delete this app/i })
}

async function confirmDelete(user: ReturnType<typeof userEvent.setup>, phrase = SITE.name) {
  const confirm = await openAndType(user, phrase)
  await waitFor(() => expect(confirm).toBeEnabled())
  // fireEvent rather than userEvent for this one click. Radix locks the body
  // with `pointer-events: none` while a dialog is open, and userEvent honours
  // that and declines to click, so the form never submits. Real browsers are
  // fine because the dialog content sets `pointer-events: auto`, which jsdom's
  // computed styles do not reflect. Verified directly: userEvent produces zero
  // requests here, fireEvent produces the one the form is supposed to send.
  fireEvent.click(confirm)
}

describe('identity', () => {
  it('shows the host, which is the thing a person actually needs from this page', async () => {
    vi.stubGlobal('fetch', cloud())
    customRender(<TaskclanSiteSettings />)
    expect(await screen.findByText('express-demo.cloud.taskclan.com')).toBeInTheDocument()
  })

  it('renders a dash for a field the engine does not send, rather than inventing one', async () => {
    // `region` is null here because the engine's rowToSite does not project it.
    // A plausible default like "Auto" would be a fabricated value.
    vi.stubGlobal('fetch', cloud())
    customRender(<TaskclanSiteSettings />)
    await screen.findByText('express-demo.cloud.taskclan.com')
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('says it could not load rather than showing an empty app', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'Cloud is down' }) }) as unknown as Response)
    )
    customRender(<TaskclanSiteSettings />)
    expect(await screen.findByText(/could not load this app/i)).toBeInTheDocument()
  })
})

describe('deleting', () => {
  it('will not delete until the app name is typed exactly', async () => {
    // The whole point of the typed confirmation: a misclick cannot destroy an
    // app. Asserted on the button's own state rather than on the absence of a
    // request, because "no request happened" is also what a broken test looks
    // like — this distinguishes the two.
    const fetchMock = cloud()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    customRender(<TaskclanSiteSettings />)
    await screen.findByText('express-demo.cloud.taskclan.com')
    const confirm = await openAndType(user, 'wrong-name')

    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(
      fetchMock.mock.calls.filter(([, i]) => (i as { method?: string })?.method === 'DELETE')
    ).toHaveLength(0)
  })

  it('deletes and leaves the app, once the name matches', async () => {
    const fetchMock = cloud()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    customRender(<TaskclanSiteSettings />)
    await screen.findByText('express-demo.cloud.taskclan.com')
    await confirmDelete(user)

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([, i]) => (i as { method?: string })?.method === 'DELETE')
      ).toHaveLength(1)
    })
    // Staying on the settings page of an app that no longer exists would leave
    // every panel on it erroring.
    await waitFor(() => expect(pushMock).toHaveBeenCalled())
  })

  it('does not navigate away when the delete failed', async () => {
    // The dangerous version of this bug is silent: the modal closes, the user
    // lands on the project list, and the app is still running and still
    // billing. Nothing on screen would say otherwise.
    vi.stubGlobal(
      'fetch',
      cloud({ ok: false, status: 500, body: { error: 'failed to delete site' } })
    )
    const user = userEvent.setup()

    customRender(<TaskclanSiteSettings />)
    await screen.findByText('express-demo.cloud.taskclan.com')
    await confirmDelete(user)

    await waitFor(() => expect(screen.queryByPlaceholderText(/type the app name/i)).toBeInTheDocument())
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("surfaces the engine's own refusal instead of a generic failure", async () => {
    // "Your role cannot delete this app" tells someone what to do next; "delete
    // failed" leaves them retrying something that cannot succeed. Asserted on
    // the toast call rather than on rendered text, because the test harness
    // does not mount sonner's Toaster — the message reaching `toast.error` is
    // the behaviour this owns.
    vi.stubGlobal(
      'fetch',
      cloud({ ok: false, status: 403, body: { error: 'your role cannot delete this app' } })
    )
    const user = userEvent.setup()

    customRender(<TaskclanSiteSettings />)
    await screen.findByText('express-demo.cloud.taskclan.com')
    await confirmDelete(user)

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith('your role cannot delete this app')
    )
  })
})
