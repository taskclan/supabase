import { describe, expect, it } from 'vitest'

import { pgMetaError, UPSTREAM_UNREACHABLE } from './pgMetaError'

const URL = 'http://127.0.0.1:8090'

describe('pgMetaError', () => {
  it('answers 502 when pg-meta never responded', () => {
    // The case that crashed the route: no HTTP response, so no code.
    const { status } = pgMetaError({ message: 'fetch failed' }, URL)
    expect(status).toBe(UPSTREAM_UNREACHABLE)
  })

  it('names the service and the address it was expected at', () => {
    const { message } = pgMetaError({ message: 'fetch failed' }, URL)
    expect(message).toContain('pg-meta')
    expect(message).toContain(URL)
  })

  it('passes through a status pg-meta actually returned, with its message', () => {
    expect(pgMetaError({ code: 404, message: 'relation does not exist' }, URL)).toEqual({
      status: 404,
      message: 'relation does not exist',
    })
  })

  it('keeps pg-meta’s own 5xx rather than relabelling it unreachable', () => {
    // It answered — "I failed" and "I am not there" are different problems and
    // should not collapse into one status.
    expect(pgMetaError({ code: 500, message: 'boom' }, URL).status).toBe(500)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['below the valid range', 99],
    ['above the valid range', 600],
    ['not an integer', 404.5],
    ['NaN', Number.NaN],
  ])('falls back to 502 for a status that is %s, which res.status() would throw on', (_l, code) => {
    expect(pgMetaError({ code }, URL).status).toBe(UPSTREAM_UNREACHABLE)
  })

  it('still produces a message when pg-meta answered without one', () => {
    expect(pgMetaError({ code: 403 }, URL).message).toBeTruthy()
  })
})

describe('pgMetaError — pg-meta URL unset', () => {
  it('says the URL is unset rather than printing it into an address', () => {
    const { status, message } = pgMetaError({ message: 'fetch failed' }, undefined)
    expect(status).toBe(UPSTREAM_UNREACHABLE)
    expect(message).toContain('STUDIO_PG_META_URL is not set')
    expect(message).not.toContain('undefined')
  })
})
