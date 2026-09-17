/**
 * Cloud API keys.
 *
 * The pure rules live in lib/taskclan/apiKeys and are tested there. These cover
 * the two things only the component can get wrong, both of which are about
 * credentials rather than layout: showing a key the user can never see again
 * without saying so, and reporting a revoke that did not happen.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskclanApiKeys } from './TaskclanApiKeys'
import { customRender } from '@/tests/lib/custom-render'

const errorToast = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => errorToast(...a), success: vi.fn(), info: vi.fn() },
}))
vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useParams: () => ({ slug: 'acme' }),
}))

const LIVE_KEY = {
  id: 'k-live',
  name: 'CI',
  keyPrefix: 'sk_cloud_ab12c',
  lastUsedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  revokedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
}
const REVOKED_KEY = {
  id: 'k-old',
  name: 'laptop',
  keyPrefix: 'sk_cloud_zz99y',
  lastUsedAt: null,
  revokedAt: '2026-09-10T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
}

const cloud = (opts: { revoke?: { ok: boolean; status: number; body: unknown } } = {}) =>
  vi.fn(async (url: string, init?: { method?: string }) => {
    const u = String(url)
    if (u.includes('/revoke')) {
      const r = opts.revoke ?? { ok: true, status: 200, body: { ok: true } }
      return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
    }
    if (init?.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({ key: 'sk_cloud_THE_ONLY_COPY_0001', record: LIVE_KEY }),
      } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ keys: [LIVE_KEY, REVOKED_KEY] }),
    } as unknown as Response
  })

afterEach(() => {
  vi.unstubAllGlobals()
  errorToast.mockReset()
})

describe('listing', () => {
  it('shows revoked keys rather than hiding them', async () => {
    // The engine's console filters them out, which loses the answer to "did I
    // already revoke the one that leaked?".
    vi.stubGlobal('fetch', cloud())
    customRender(<TaskclanApiKeys />)
    expect(await screen.findByText('CI')).toBeInTheDocument()
    expect(await screen.findByText('laptop')).toBeInTheDocument()
  })

  it('warns that CLI login keys live in this list', async () => {
    // `taskclan login` mints a key named after the machine and stores it in
    // ~/.netrc, so rows like "taskclan CLI (some-laptop)" are live login
    // credentials. Without this note somebody tidies one away and loses
    // `git push` on that machine with no idea why.
    vi.stubGlobal('fetch', cloud())
    customRender(<TaskclanApiKeys />)
    expect(await screen.findByText(/CLI creates one of these too/i)).toBeInTheDocument()
  })
})

describe('creating', () => {
  it('shows the plaintext once and says it will not be shown again', async () => {
    // The engine stores only a hash. If this panel renders the key without
    // saying so, the honest default assumption — that it can be read again
    // later — is wrong, and the key is simply lost.
    vi.stubGlobal('fetch', cloud())
    const user = userEvent.setup()

    customRender(<TaskclanApiKeys />)
    await screen.findByText('CI')
    await user.click(screen.getByRole('button', { name: /create key/i }))

    expect(await screen.findByText('sk_cloud_THE_ONLY_COPY_0001')).toBeInTheDocument()
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument()
  })
})

describe('revoking', () => {
  it('leads with when the key was last used', async () => {
    // "Used an hour ago" and "never used" call for opposite decisions, and the
    // engine records which it is — so the confirmation should not be generic.
    vi.stubGlobal('fetch', cloud())
    const user = userEvent.setup()

    customRender(<TaskclanApiKeys />)
    await screen.findByText('CI')
    await user.click(screen.getAllByRole('button', { name: /revoke/i })[0])

    expect(await screen.findByText(/using it right now/i)).toBeInTheDocument()
  })

  it('does not report a failed revoke as success', async () => {
    // The dangerous version: someone revokes a leaked key, sees a success
    // toast, and stops worrying about a credential that is still live.
    vi.stubGlobal(
      'fetch',
      cloud({ revoke: { ok: false, status: 500, body: { error: 'could not revoke' } } })
    )
    const user = userEvent.setup()

    customRender(<TaskclanApiKeys />)
    await screen.findByText('CI')
    await user.click(screen.getAllByRole('button', { name: /revoke/i })[0])

    const confirm = await screen.findByRole('button', { name: /revoke key/i })
    // fireEvent because Radix sets pointer-events:none on body while a dialog
    // is open and userEvent honours it; see TaskclanSiteSettings.test.tsx.
    fireEvent.click(confirm)

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('could not revoke'))
  })
})
