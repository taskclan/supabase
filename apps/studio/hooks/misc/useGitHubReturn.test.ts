/**
 * Coming back from installing the GitHub App.
 *
 * Cloud's callback lands the person on the page they began on with
 * `?git=<outcome>`. The page has to say what happened, and only once: the
 * marker comes out of the URL so a reload does not announce it again.
 */
import { renderHook, waitFor } from '@testing-library/react'
import mockRouter from 'next-router-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useGitHubReturn } from './useGitHubReturn'

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))
vi.mock('sonner', () => ({ toast }))

beforeEach(() => {
  toast.success.mockClear()
  toast.warning.mockClear()
  toast.error.mockClear()
})

describe('useGitHubReturn', () => {
  it('says the install worked, and takes only its own marker out of the URL', async () => {
    mockRouter.setCurrentUrl('/org/acme/integrations?git=connected&tab=github')
    const onReturn = vi.fn()

    renderHook(() => useGitHubReturn(onReturn))

    await waitFor(() => expect(mockRouter.query).not.toHaveProperty('git'))
    expect(mockRouter.asPath).toBe('/org/acme/integrations?tab=github')
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith(
      'GitHub connected',
      expect.objectContaining({ id: 'github-return' })
    )
    expect(onReturn).toHaveBeenCalledTimes(1)
    expect(onReturn).toHaveBeenCalledWith('connected')
  })

  it('warns rather than celebrates when the workspace was lost on the way', async () => {
    mockRouter.setCurrentUrl('/project/aiya-app/deployments?git=unattributed')

    renderHook(() => useGitHubReturn())

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning.mock.calls[0][1].description).toMatch(/uninstall/i)
  })

  it('reports a failed install as one', async () => {
    mockRouter.setCurrentUrl('/new/acme?git=error')

    renderHook(() => useGitHubReturn())

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockRouter.asPath).toBe('/new/acme'))
  })

  it('says nothing on an ordinary visit', async () => {
    mockRouter.setCurrentUrl('/org/acme/integrations')
    const onReturn = vi.fn()

    renderHook(() => useGitHubReturn(onReturn))

    // Nothing to wait for, so give an effect the chance to run before saying
    // it did not.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onReturn).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(mockRouter.asPath).toBe('/org/acme/integrations')
  })

  it('leaves alone a marker it does not recognise', async () => {
    mockRouter.setCurrentUrl('/org/acme/integrations?git=maybe')
    const onReturn = vi.fn()

    renderHook(() => useGitHubReturn(onReturn))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onReturn).not.toHaveBeenCalled()
    expect(mockRouter.asPath).toBe('/org/acme/integrations?git=maybe')
  })
})
