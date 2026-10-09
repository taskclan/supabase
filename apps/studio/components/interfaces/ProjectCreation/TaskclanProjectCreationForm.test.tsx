/**
 * The new-app form's trip out to GitHub and back.
 *
 * Installing the GitHub App is a full page load to GitHub and another back, so
 * nothing the form held survives on its own. Coming back has to put the person
 * where they left: at the repository picker, with the name and type they had
 * already chosen.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import mockRouter from 'next-router-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskclanProjectCreationForm } from './TaskclanProjectCreationForm'
import { customRender } from '@/tests/lib/custom-render'

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('sonner', () => ({ toast }))

const DRAFT_KEY = 'taskclan-new-app-draft'
const INSTALL = 'https://github.com/apps/taskclan-cloud/installations/new?state=x'
const AIYA_REPO = {
  fullName: 'taskclan/taskclan-aiya-web',
  defaultBranch: 'main',
  private: true,
  installationId: 7,
  owner: 'taskclan',
}

/** The console API, with only the repository list varying between tests. */
function consoleApi(repos: unknown[]) {
  const fetchMock = vi.fn(async (input: string) => {
    const path = input.split('?')[0]
    const body =
      path === '/api/taskclan/github/repos'
        ? { repos }
        : path === '/api/taskclan/github/connect'
          ? { url: INSTALL }
          : path === '/api/taskclan/site-check'
            ? { valid: true, available: true, subdomain: 'aiya-web', host: 'aiya-web.taskclan.app' }
            : {}
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const realLocation = window.location

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', {
    value: realLocation,
    writable: true,
    configurable: true,
  })
})

describe('TaskclanProjectCreationForm, back from GitHub', () => {
  it('returns to the repository picker with what the person had typed', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name: 'aiya-web', type: 'static' }))
    mockRouter.setCurrentUrl('/new/acme?git=connected')
    consoleApi([AIYA_REPO])

    customRender(<TaskclanProjectCreationForm />)

    expect(await screen.findByText('Select a repository…')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /import from github/i })).toBeChecked()
    expect(screen.getByLabelText('Project name')).toHaveValue('aiya-web')
    expect(screen.getByRole('radio', { name: /static site/i })).toBeChecked()
    expect(toast.success).toHaveBeenCalledWith('GitHub connected', expect.anything())
    // Read once: a later visit starts from a clean form.
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
    await waitFor(() => expect(mockRouter.asPath).toBe('/new/acme'))
  })

  it('lands a failed install on the same picker, where trying again starts', async () => {
    mockRouter.setCurrentUrl('/new/acme?git=error')
    consoleApi([])

    customRender(<TaskclanProjectCreationForm />)

    expect(await screen.findByRole('button', { name: 'Connect to GitHub' })).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalled()
  })

  it('starts empty on an ordinary visit, whatever a draft says', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name: 'aiya-web', type: 'static' }))
    mockRouter.setCurrentUrl('/new/acme')
    consoleApi([AIYA_REPO])

    customRender(<TaskclanProjectCreationForm />)

    expect(await screen.findByRole('radio', { name: /start empty/i })).toBeChecked()
    expect(screen.getByLabelText('Project name')).toHaveValue('')
  })

  it('keeps the draft and this page as the way back when it leaves for GitHub', async () => {
    const page = 'https://cloud.taskclan.com/new/acme'
    const location = { href: page, origin: 'https://cloud.taskclan.com' }
    Object.defineProperty(window, 'location', {
      value: location,
      writable: true,
      configurable: true,
    })
    mockRouter.setCurrentUrl('/new/acme')
    const fetchMock = consoleApi([])

    customRender(<TaskclanProjectCreationForm />)
    await userEvent.type(screen.getByLabelText('Project name'), 'aiya-web')
    await userEvent.click(screen.getByRole('radio', { name: /static site/i }))
    await userEvent.click(screen.getByRole('radio', { name: /import from github/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Connect to GitHub' }))

    await waitFor(() => expect(location.href).toBe(INSTALL))
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null')).toEqual({
      name: 'aiya-web',
      type: 'static',
    })
    const asked = fetchMock.mock.calls
      .map(([input]) => input)
      .find((input) => input.startsWith('/api/taskclan/github/connect'))
    expect(new URLSearchParams(asked?.split('?')[1]).get('returnTo')).toBe(page)
  })
})
