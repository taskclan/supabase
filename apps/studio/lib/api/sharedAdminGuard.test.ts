import { beforeEach, describe, expect, it, vi } from 'vitest'

// TASKCLAN_AUTH_ENABLED is a build-time const; a getter lets each test vary it.
let authEnabled = false
vi.mock('@/lib/constants', () => ({
  get TASKCLAN_AUTH_ENABLED() {
    return authEnabled
  },
}))

import { assertSharedAdminAllowed } from './sharedAdminGuard'
import { selfHostedSupabaseAdmin } from './self-hosted-admin'

/**
 * The surface audit's guarantee: nothing reaches the shared project's admin
 * credentials once per-user auth is on. Two mechanisms — an explicit guard on
 * the 9 routes that read the service key/URL directly, and a proxy trap on the
 * shared admin client the 17 storage/auth-user routes use. The engine calls are
 * scoped separately by callerContext/engineProxy; these hit the shared Supabase
 * directly, so they need their own guard.
 */
describe('shared-admin isolation (surface audit)', () => {
  beforeEach(() => {
    authEnabled = false
  })

  it('the guard refuses when auth is on, no-ops when off', () => {
    authEnabled = true
    expect(() => assertSharedAdminAllowed()).toThrow(/not available/)
    authEnabled = false
    expect(() => assertSharedAdminAllowed()).not.toThrow()
  })

  it('the shared admin client refuses (never constructs) when auth is on', () => {
    authEnabled = true
    expect(() => selfHostedSupabaseAdmin.auth).toThrow(/not available/)
    expect(() => selfHostedSupabaseAdmin.storage).toThrow(/not available/)
  })
})
