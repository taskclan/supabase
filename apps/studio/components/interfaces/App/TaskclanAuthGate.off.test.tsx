/**
 * With auth unconfigured the gate must be a no-op.
 *
 * Its own file because the constant is mocked per module, and this is the case
 * that has to hold every single day until the variables are set: the gate ships
 * in production long before auth does, and if it gated anything in the meantime
 * it would lock everybody out of a console that has no way to sign in.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { customRender } from '@/tests/lib/custom-render'

const replace = vi.fn()

vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('common')>()),
  useIsUserLoading: () => false,
  useIsLoggedIn: () => false,
}))

vi.mock('next/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/router')>()),
  useRouter: () => ({ pathname: '/project/[ref]', asPath: '/project/ostrae', replace, query: {} }),
}))

vi.mock('@/lib/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/constants')>()),
  TASKCLAN_AUTH_ENABLED: false,
}))

const { TaskclanAuthGate } = await import('./TaskclanAuthGate')

describe('TaskclanAuthGate with auth off', () => {
  it('renders the console and redirects nobody', () => {
    customRender(
      <TaskclanAuthGate>
        <div>the console</div>
      </TaskclanAuthGate>
    )

    expect(screen.getByText('the console')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})
