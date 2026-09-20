import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/taskclan/session', () => ({ cloudSignupEnabled: vi.fn() }))

import { assertSharedAdminAllowed } from './sharedAdminGuard'
import { selfHostedSupabaseAdmin } from './self-hosted-admin'
import { cloudSignupEnabled } from '@/lib/taskclan/session'

/**
 * The surface audit's guarantee: nothing reaches the shared project's admin
 * credentials on a customer path. Two mechanisms — an explicit guard on the 9
 * routes that read the service key/URL directly, and a proxy trap on the shared
 * admin client the 17 storage/auth-user routes use.
 */
describe('shared-admin isolation (surface audit)', () => {
  beforeEach(() => vi.mocked(cloudSignupEnabled).mockReset())

  it('assertSharedAdminAllowed refuses when signup is on, no-ops when off', () => {
    vi.mocked(cloudSignupEnabled).mockReturnValue(true)
    expect(() => assertSharedAdminAllowed()).toThrow(/not available/)
    vi.mocked(cloudSignupEnabled).mockReturnValue(false)
    expect(() => assertSharedAdminAllowed()).not.toThrow()
  })

  it('the shared admin client refuses (never constructs) when signup is on', () => {
    vi.mocked(cloudSignupEnabled).mockReturnValue(true)
    // Accessing any property must throw before the shared service_role client is built.
    expect(() => selfHostedSupabaseAdmin.auth).toThrow(/not available/)
    expect(() => selfHostedSupabaseAdmin.storage).toThrow(/not available/)
  })
})
