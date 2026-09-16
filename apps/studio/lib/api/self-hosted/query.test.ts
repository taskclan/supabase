/**
 * executeQuery when pg-meta is not there.
 *
 * The fetch to pg-meta used to sit outside any try, so a connection refusal
 * escaped executeQuery instead of being returned as `error`. apiWrapper caught
 * it and JSON.stringify rendered the Error as `{}` — an Error has no enumerable
 * own properties — so the database screens received `{"error":{}}` and showed
 * "API error happened while trying to communicate with the server", next to a
 * Restart database button that could not have helped.
 *
 * The assertion is that the failure comes back as a value with a message
 * naming the service, rather than as a throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { executeQuery } from './query'

vi.mock('./util', () => ({
  assertSelfHosted: () => {},
  encryptString: (s: string) => s,
  getConnectionStringForRef: async () => 'postgresql://postgres@localhost:5432/postgres',
}))

vi.mock('@sentry/nextjs', () => ({
  startSpan: (_opts: unknown, fn: (span: { setAttribute: () => void }) => unknown) =>
    fn({ setAttribute: () => {} }),
}))

describe('executeQuery — pg-meta unreachable', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('returns the failure instead of throwing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const result = await executeQuery({ query: 'select 1' })

    expect(result.data).toBeUndefined()
    expect(result.error).toBeInstanceOf(Error)
  })

  it('says pg-meta could not be reached, so the screen can say why', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const { error } = await executeQuery({ query: 'select 1' })

    expect(error?.message).toContain('pg-meta')
    // The underlying cause is kept: "fetch failed" vs a DNS error vs a timeout
    // are different problems and the message should not flatten them.
    expect(error?.message).toContain('fetch failed')
  })

  it('carries a message that survives JSON serialization', async () => {
    // The original defect was not that an error was missing — it was that the
    // error serialized to nothing by the time it reached the browser.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const { error } = await executeQuery({ query: 'select 1' })

    expect(JSON.parse(JSON.stringify({ message: error?.message })).message).toBeTruthy()
  })

  it('still returns rows when pg-meta answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{ one: 1 }] })
    )

    const { data, error } = await executeQuery({ query: 'select 1' })

    expect(error).toBeUndefined()
    expect(data).toEqual([{ one: 1 }])
  })
})
