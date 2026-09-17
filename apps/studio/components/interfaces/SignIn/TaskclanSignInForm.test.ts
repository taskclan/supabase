import { describe, expect, it } from 'vitest'

import { safeReturnTo } from './TaskclanSignInForm'
import { DEFAULT_FALLBACK_PATH } from '@/lib/gotrue'
import { TASKCLAN_AUTH_REDIRECTS } from '@/redirects.shared'

/**
 * Where signing in sends you.
 *
 * Two properties, and the second only became load-bearing on 2026-09-17 when
 * `/` started serving the landing page.
 */

describe('safeReturnTo', () => {
  it('refuses anything that could leave this origin', () => {
    // The open-redirect case: //evil.com is a protocol-relative URL, so a
    // browser treats it as another host even though it starts with a slash.
    expect(safeReturnTo('//evil.example.com')).toBe(DEFAULT_FALLBACK_PATH)
    expect(safeReturnTo('https://evil.example.com')).toBe(DEFAULT_FALLBACK_PATH)
    expect(safeReturnTo(undefined)).toBe(DEFAULT_FALLBACK_PATH)
    expect(safeReturnTo(['/a', '/b'])).toBe(DEFAULT_FALLBACK_PATH)
  })

  it('keeps a real path so a deep link survives the login', () => {
    expect(safeReturnTo('/project/abc123/editor')).toBe('/project/abc123/editor')
  })

  it('never defaults to a path that redirects back to sign-in', () => {
    // The loop this guards: `/` now redirects to the landing page, and the
    // landing page is where people click "sign in" from. A default of '/'
    // would therefore return somebody who just authenticated to the marketing
    // page they started on, looking exactly like a failed login.
    const rootGoesTo = TASKCLAN_AUTH_REDIRECTS.find((r) => r.source === '/')?.destination
    expect(rootGoesTo).toBe('/landing')
    expect(safeReturnTo(undefined)).not.toBe('/')
    expect(safeReturnTo(undefined)).not.toBe(rootGoesTo)
  })
})
