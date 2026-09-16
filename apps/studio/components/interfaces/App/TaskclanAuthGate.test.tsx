/**
 * The gate, tested at its decision rather than through a rendered console.
 *
 * Every case below is one where the wrong answer is quiet. Redirecting during
 * the loading window bounces people who ARE signed in, and looks like a session
 * that will not stick. Rendering during it shows the console to somebody who is
 * not. Neither throws, and both are easy to mistake for a slow network.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { customRender } from '@/tests/lib/custom-render'

const replace = vi.fn()
const authState = vi.hoisted(() => ({ isLoading: false, isLoggedIn: false }))
const route = vi.hoisted(() => ({ pathname: '/project/[ref]', asPath: '/project/ostrae' }))

vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('common')>()),
  useIsUserLoading: () => authState.isLoading,
  useIsLoggedIn: () => authState.isLoggedIn,
}))

vi.mock('next/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/router')>()),
  useRouter: () => ({ ...route, replace, query: {} }),
}))

vi.mock('@/lib/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/constants')>()),
  TASKCLAN_AUTH_ENABLED: true,
}))

const { TaskclanAuthGate } = await import('./TaskclanAuthGate')

const Protected = () => <div>the console</div>

beforeEach(() => {
  authState.isLoading = false
  authState.isLoggedIn = false
  route.pathname = '/project/[ref]'
  route.asPath = '/project/ostrae'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TaskclanAuthGate', () => {
  it('shows nothing and does not redirect while the session is still loading', () => {
    // The session is read asynchronously, so for the first moment of every page
    // load "not signed in yet" is indistinguishable from "not signed in".
    // Redirecting here is the flash-of-sign-in bug, and it bounces people who
    // are perfectly well signed in.
    authState.isLoading = true

    customRender(
      <TaskclanAuthGate>
        <Protected />
      </TaskclanAuthGate>
    )

    expect(screen.queryByText('the console')).not.toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('sends a signed-out visitor to sign in, remembering where they were going', () => {
    customRender(
      <TaskclanAuthGate>
        <Protected />
      </TaskclanAuthGate>
    )

    expect(replace).toHaveBeenCalledWith('/sign-in?returnTo=%2Fproject%2Fostrae')
    expect(screen.queryByText('the console')).not.toBeInTheDocument()
  })

  it('returns to the actual app, not the route pattern', () => {
    // asPath rather than pathname: /project/[ref] would send somebody to a
    // literal bracketed path after signing in.
    customRender(
      <TaskclanAuthGate>
        <Protected />
      </TaskclanAuthGate>
    )

    expect(replace).toHaveBeenCalledWith(expect.stringContaining('ostrae'))
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining('%5Bref%5D'))
  })

  it('lets a signed-in visitor through', () => {
    authState.isLoggedIn = true

    customRender(
      <TaskclanAuthGate>
        <Protected />
      </TaskclanAuthGate>
    )

    expect(screen.getByText('the console')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it.each(['/landing', '/sign-in', '/404', '/500'])(
    'renders %s to a signed-out visitor',
    (pathname) => {
      // The sign-in page especially: gating it is a redirect loop.
      route.pathname = pathname

      customRender(
        <TaskclanAuthGate>
          <Protected />
        </TaskclanAuthGate>
      )

      expect(screen.getByText('the console')).toBeInTheDocument()
      expect(replace).not.toHaveBeenCalled()
    }
  )

  it.each(['/sign-up', '/forgot-password', '/authorize', '/cli/login'])(
    'gates %s, which this console does not run',
    (pathname) => {
      // Upstream platform flows. They rendered to anyone before; leaving them
      // out of the allowlist is the improvement, not an oversight.
      route.pathname = pathname

      customRender(
        <TaskclanAuthGate>
          <Protected />
        </TaskclanAuthGate>
      )

      expect(screen.queryByText('the console')).not.toBeInTheDocument()
    }
  )
})
