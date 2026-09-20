import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The SQL editor's connection scoping under multi-tenant signup (P4).
 *
 * The process-wide connection is the SHARED control-plane database — it holds
 * cloud_api_keys. With signup on, `getConnectionStringForRef` must NEVER return
 * it: a request with no session (perAppCredentialsEnabled() is false without
 * one) or no ref is refused, not silently pointed at the shared DB. With signup
 * off it stays plain self-hosted, exactly as upstream.
 */

vi.mock('@/lib/taskclan/db-credential', () => ({
  perAppCredentialsEnabled: vi.fn(() => false),
  credentialForRef: vi.fn(),
}))
vi.mock('@/lib/taskclan/session', () => ({
  cloudSignupEnabled: vi.fn(() => false),
}))

import { getConnectionStringForRef } from './util'
import { credentialForRef, perAppCredentialsEnabled } from '@/lib/taskclan/db-credential'
import { cloudSignupEnabled } from '@/lib/taskclan/session'

describe('getConnectionStringForRef — multi-tenant DB isolation (P4)', () => {
  beforeEach(() => {
    vi.mocked(cloudSignupEnabled).mockReturnValue(false)
    vi.mocked(perAppCredentialsEnabled).mockReturnValue(false)
    vi.mocked(credentialForRef).mockReset()
  })

  it('signup ON + no session ⇒ refuses (never the shared DB)', async () => {
    vi.mocked(cloudSignupEnabled).mockReturnValue(true)
    vi.mocked(perAppCredentialsEnabled).mockReturnValue(false) // no session
    await expect(getConnectionStringForRef({ readOnly: true, ref: 'app-1' })).rejects.toThrow(
      /No database is connected/
    )
  })

  it('signup ON + no ref ⇒ refuses', async () => {
    vi.mocked(cloudSignupEnabled).mockReturnValue(true)
    vi.mocked(perAppCredentialsEnabled).mockReturnValue(true)
    await expect(getConnectionStringForRef({ readOnly: true })).rejects.toThrow(/No database is connected/)
  })

  it('signup ON + session + ref ⇒ the org-scoped credential, not the shared DB', async () => {
    vi.mocked(cloudSignupEnabled).mockReturnValue(true)
    vi.mocked(perAppCredentialsEnabled).mockReturnValue(true)
    vi.mocked(credentialForRef).mockResolvedValue({
      ok: true,
      connectionString: 'postgresql://scoped_role:pw@app-1-host/appdb',
    })
    const cs = await getConnectionStringForRef({ readOnly: true, ref: 'app-1' })
    expect(cs).toBe('postgresql://scoped_role:pw@app-1-host/appdb')
  })

  it('signup OFF ⇒ plain self-hosted shared connection (unchanged)', async () => {
    vi.mocked(cloudSignupEnabled).mockReturnValue(false)
    vi.mocked(perAppCredentialsEnabled).mockReturnValue(false)
    const cs = await getConnectionStringForRef({ readOnly: true })
    expect(cs).toMatch(/^postgresql:\/\//)
  })
})
