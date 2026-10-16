import { describe, expect, it } from 'vitest'

import { safeReturnTo } from './TaskclanSignInForm'
import { DEFAULT_FALLBACK_PATH } from '@/lib/gotrue'

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

  it('never defaults to the landing page a sign-in came from', () => {
    // The loop this guards: `/` IS the landing page now, and the landing page
    // is where people click "sign in" from. A default returnTo of `/` would
    // return somebody who just authenticated to the marketing page they started
    // on, looking exactly like a failed login. `/landing` is the same trap — it
    // redirects to `/`.
    expect(safeReturnTo(undefined)).not.toBe('/')
    expect(safeReturnTo(undefined)).not.toBe('/landing')
  })
})
