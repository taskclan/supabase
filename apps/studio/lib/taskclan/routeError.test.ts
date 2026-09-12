import { describe, expect, it } from 'vitest'

import { classifyProjectError, messageFor, shouldStay } from './routeError'

/**
 * The regression Daniel actually hit: Taskclan Cloud was briefly unreachable
 * and the dashboard said "You do not have access to this project", then
 * redirected to a home page that failed the same way.
 */

describe('classifyProjectError', () => {
  it('does not call an unreachable backend a permissions problem', () => {
    // The bug, stated as a test. Upstream produced 'no_access' for all of these.
    expect(classifyProjectError(502)).toBe('unreachable')
    expect(classifyProjectError(500)).toBe('unreachable')
    expect(classifyProjectError(503)).toBe('unreachable')
    expect(classifyProjectError(504)).toBe('unreachable')
  })

  it('treats no response at all as unreachable', () => {
    // A request that never arrived cannot have been refused.
    expect(classifyProjectError(undefined)).toBe('unreachable')
  })

  it('still reports a genuine refusal', () => {
    expect(classifyProjectError(401)).toBe('no_access')
    expect(classifyProjectError(403)).toBe('no_access')
  })

  it('keeps 404 meaning gone, as upstream had it', () => {
    expect(classifyProjectError(404)).toBe('gone')
  })

  it('does not tell someone they lack access when the request was malformed', () => {
    // A 400 would send them to ask for a permission they already have.
    expect(classifyProjectError(400)).toBe('unreachable')
    expect(classifyProjectError(422)).toBe('unreachable')
  })
})

describe('shouldStay', () => {
  it('stays put only when the backend is the problem', () => {
    // Redirecting here lands the user on a page that needs the same backend.
    expect(shouldStay('unreachable')).toBe(true)
    expect(shouldStay('no_access')).toBe(false)
    expect(shouldStay('gone')).toBe(false)
  })
})

describe('messageFor', () => {
  it('says what happened, and says it is not about permissions', () => {
    const m = messageFor('unreachable') ?? ''
    expect(m).toContain('Taskclan Cloud')
    expect(m).toContain('not a permissions problem')
    expect(m).not.toContain('do not have access')
  })

  it('keeps the access message for a real refusal', () => {
    expect(messageFor('no_access')).toBe('You do not have access to this project')
  })

  it('stays silent for a deleted app', () => {
    expect(messageFor('gone')).toBeNull()
  })
})
