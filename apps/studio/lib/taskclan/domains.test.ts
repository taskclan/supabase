import { describe, expect, it } from 'vitest'

import {
  domainExplanation,
  domainHealth,
  hostnameError,
  isValidHostname,
  normalizeHostname,
  pendingRecords,
  type CustomDomain,
} from './domains'

/**
 * The mirror of the engine's validator, and the reading of its status fields.
 *
 * Both fail quietly when wrong. A validator looser than the engine's just moves
 * the rejection later; one tighter refuses hostnames that would have worked.
 * And calling a domain "live" before its certificate exists tells somebody
 * their site is up while visitors get a browser security warning.
 */

const domain = (over: Partial<CustomDomain> = {}): CustomDomain => ({
  hostname: 'app.example.com',
  provider: 'saas',
  status: 'active',
  sslStatus: 'active',
  errors: [],
  records: [],
  ...over,
})

describe('normalizeHostname', () => {
  it('accepts a pasted URL, because that is what people paste', () => {
    // Rejecting this as invalid would be technically defensible and useless.
    expect(normalizeHostname('https://app.example.com/dashboard')).toBe('app.example.com')
    expect(normalizeHostname('  APP.Example.COM  ')).toBe('app.example.com')
  })
})

describe('isValidHostname', () => {
  it('matches the engine on things it accepts', () => {
    // Transcribed from src/lib/cloud/hosting/sites.ts isValidCustomDomain.
    expect(isValidHostname('app.example.com')).toBe(true)
    expect(isValidHostname('a.co')).toBe(true)
    expect(isValidHostname('deep.sub.domain.example.com')).toBe(true)
  })

  it('matches the engine on things it rejects', () => {
    expect(isValidHostname('example')).toBe(false) // no TLD
    expect(isValidHostname('app.example.c')).toBe(false) // TLD too short
    expect(isValidHostname('app example.com')).toBe(false) // space
    expect(isValidHostname('app.example.com:8080')).toBe(false) // port
    expect(isValidHostname('app.example.com/path')).toBe(false) // path
    expect(isValidHostname('')).toBe(false)
    expect(isValidHostname(`${'a'.repeat(250)}.com`)).toBe(false) // over 253
  })

  it('is not looser than the engine on a leading hyphen', () => {
    // If this passed here and failed there, the form would accept it and the
    // user would get the rejection one round trip later.
    expect(isValidHostname('-bad.example.com')).toBe(false)
  })
})

describe('domainHealth', () => {
  it('is only live when routing AND the certificate are both active', () => {
    // The dangerous middle state: routed with no cert means visitors see a
    // security warning. Calling that live would be a confident lie.
    expect(domainHealth(domain())).toBe('live')
    expect(domainHealth(domain({ sslStatus: 'pending_validation' }))).toBe('pending')
    expect(domainHealth(domain({ status: 'verifying' }))).toBe('pending')
  })

  it('reports Cloudflare errors as failed rather than pending', () => {
    // Pending implies "wait"; this one will never resolve on its own.
    expect(domainHealth(domain({ errors: ['certificate validation timed out'] }))).toBe('failed')
  })

  it('separates a redirect from a domain that serves the app', () => {
    expect(domainHealth(domain({ redirectTo: 'www.example.com' }))).toBe('redirect')
  })
})

describe('domainExplanation', () => {
  it("passes Cloudflare's own message through on failure", () => {
    // It names the actual problem and is what support would ask for. A generic
    // "something went wrong" would be strictly less useful.
    const text = domainExplanation(domain({ errors: ['certificate validation timed out'] }))
    expect(text).toContain('certificate validation timed out')
  })

  it('tells someone to add records only when records are actually missing', () => {
    const missing = domain({
      status: 'verifying',
      sslStatus: 'pending_validation',
      records: [{ type: 'TXT', name: '_acme', value: 'x', state: 'missing' }],
    })
    expect(domainExplanation(missing)).toContain('Add the records below')
  })

  it('does not send someone back to DNS once the records have resolved', () => {
    // This is the state people get stuck in: records added, certificate still
    // issuing. Repeating "add the records" makes them re-check finished work.
    const waiting = domain({
      status: 'verifying',
      sslStatus: 'pending_validation',
      records: [{ type: 'TXT', name: '_acme', value: 'x', state: 'ok' }],
    })
    const text = domainExplanation(waiting)
    expect(text).not.toContain('Add the records')
    expect(text).toContain('certificate')
  })

  it('says a redirect does not serve the app', () => {
    const text = domainExplanation(domain({ redirectTo: 'www.example.com' }))
    expect(text).toContain('does not serve this app')
  })
})

describe('pendingRecords', () => {
  it('counts anything not confirmed resolved, including unknown', () => {
    // An unresolved lookup is not evidence the record is there. Treating
    // unknown as done would hide a genuinely missing record.
    const d = domain({
      records: [
        { type: 'CNAME', name: 'app', value: 'x', state: 'ok' },
        { type: 'TXT', name: '_acme', value: 'y', state: 'missing' },
        { type: 'TXT', name: '_other', value: 'z' },
      ],
    })
    expect(pendingRecords(d)).toHaveLength(2)
  })
})

describe('hostnameError', () => {
  it('says nothing before anything is typed', () => {
    expect(hostnameError('')).toBeNull()
  })

  it('catches a duplicate before the round trip', () => {
    expect(hostnameError('app.example.com', ['app.example.com'])).toContain('already attached')
  })

  it('compares duplicates on the normalised form', () => {
    // Otherwise pasting the URL form of an attached domain looks like a new one
    // and gets a 409 from the engine instead of an inline message.
    expect(hostnameError('https://APP.example.com/', ['app.example.com'])).toContain(
      'already attached'
    )
  })
})
