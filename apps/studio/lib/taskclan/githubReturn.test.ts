/**
 * The way back from installing the GitHub App.
 *
 * Cloud's connect route reads two parameters, `origin` and `returnPath`, and
 * this console sent a third it never read. So these pin the split itself, and
 * that a page always comes back in a shape Cloud accepts: one it refuses is
 * swapped for a default page that this console does not have.
 */
import { describe, expect, it } from 'vitest'

import { GITHUB_OUTCOMES, githubOutcome, returnTarget } from './githubReturn'

const CONSOLE = 'https://cloud.taskclan.com'

describe('returnTarget', () => {
  it.each([
    ['the new-app form', '/new/acme'],
    ['the Integrations page', '/org/acme/integrations'],
    ["an app's Deployments page", '/project/aiya-app/deployments'],
  ])('splits %s into the host and the page', (_page, path) => {
    expect(returnTarget(`${CONSOLE}${path}`)).toEqual({ origin: CONSOLE, returnPath: path })
  })

  it('keeps the query a page carries', () => {
    expect(returnTarget(`${CONSOLE}/new/acme?source=github`)).toEqual({
      origin: CONSOLE,
      returnPath: '/new/acme?source=github',
    })
  })

  it('leaves out the outcome an earlier attempt left in the URL', () => {
    // Otherwise the page comes back with two, the stale one first.
    expect(returnTarget(`${CONSOLE}/org/acme/integrations?git=error`)).toEqual({
      origin: CONSOLE,
      returnPath: '/org/acme/integrations',
    })
    expect(returnTarget(`${CONSOLE}/new/acme?git=error&source=github`)?.returnPath).toBe(
      '/new/acme?source=github'
    )
  })

  it("drops a query Cloud would refuse, rather than the page it's on", () => {
    // Refused, the person would land on a page this console does not have.
    const long = `${CONSOLE}/project/aiya-app/deployments?q=${'a'.repeat(250)}`
    expect(returnTarget(long)?.returnPath).toBe('/project/aiya-app/deployments')
    const colon = `${CONSOLE}/project/aiya-app/deployments?since=12:00`
    expect(returnTarget(colon)?.returnPath).toBe('/project/aiya-app/deployments')
  })

  it('leaves the origin for Cloud to judge', () => {
    // A local console is not a host Cloud returns to; it says so itself, by
    // sending the person to its own console instead.
    expect(returnTarget('http://localhost:8082/new/acme')).toEqual({
      origin: 'http://localhost:8082',
      returnPath: '/new/acme',
    })
  })

  it('has nothing to send for something that is not a page', () => {
    expect(returnTarget(undefined)).toBeNull()
    expect(returnTarget('')).toBeNull()
    expect(returnTarget('/new/acme')).toBeNull()
    expect(returnTarget(['https://cloud.taskclan.com/new/acme'])).toBeNull()
    expect(returnTarget('javascript:alert(1)')).toBeNull()
  })
})

describe('githubOutcome', () => {
  it("names each outcome Cloud's callback sends", () => {
    for (const outcome of ['connected', 'installed', 'unattributed', 'error'] as const) {
      expect(githubOutcome(outcome)).toBe(outcome)
      expect(GITHUB_OUTCOMES[outcome].title).toBeTruthy()
    }
  })

  it('ignores anything else, including what every object has', () => {
    expect(githubOutcome(undefined)).toBeNull()
    expect(githubOutcome('connectedd')).toBeNull()
    expect(githubOutcome('toString')).toBeNull()
    expect(githubOutcome(['connected'])).toBeNull()
  })

  it('only calls a connection a success', () => {
    expect(GITHUB_OUTCOMES.connected.tone).toBe('success')
    expect(GITHUB_OUTCOMES.installed.tone).toBe('warning')
    expect(GITHUB_OUTCOMES.unattributed.tone).toBe('warning')
    expect(GITHUB_OUTCOMES.error.tone).toBe('error')
  })
})
