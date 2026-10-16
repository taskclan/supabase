/**
 * A failed request's reason reaches the toast.
 *
 * Our `/api/platform/*` and `/api/v1/*` routes put it at `error.message`, and
 * Taskclan Cloud at `error`. handleError reads only `msg`/`message`, so each
 * of those failures showed "API error happened while trying to communicate with
 * the server", including the Delete organization 405 that went unexplained.
 */
import { describe, expect, it } from 'vitest'

import { handleError } from '@/data/fetchers'
import { liftErrorMessage } from './errorBody'

const messageOf = (body: unknown) => (body as { message?: string }).message

const thrownMessage = (body: unknown): string => {
  try {
    handleError(body)
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('handleError did not throw')
}

describe('liftErrorMessage', () => {
  it("lifts our routes' { data: null, error: { message } }", () => {
    expect(liftErrorMessage({ data: null, error: { message: 'Only the workspace owner can delete it.' } })).toMatchObject({
      message: 'Only the workspace owner can delete it.',
      error: { message: 'Only the workspace owner can delete it.' },
    })
  })

  it("lifts Taskclan Cloud's { error: '...' }", () => {
    expect(messageOf(liftErrorMessage({ error: 'site not found' }))).toBe('site not found')
  })

  it('prefers an error_description to a bare error code', () => {
    expect(messageOf(liftErrorMessage({ error: 'invalid_request', error_description: 'Missing name' }))).toBe('Missing name')
  })

  it('never replaces a reason that is already where it belongs', () => {
    expect(messageOf(liftErrorMessage({ message: 'top', error: { message: 'nested' } }))).toBe('top')
    expect(liftErrorMessage({ msg: 'gotrue', error: 'nested' })).not.toHaveProperty('message')
  })

  it('leaves bodies that are not objects as they are', () => {
    expect(liftErrorMessage(null)).toBeNull()
    expect(liftErrorMessage('plain text')).toBe('plain text')
    expect(liftErrorMessage([{ error: 'x' }])).toEqual([{ error: 'x' }])
    expect(liftErrorMessage({ error: { code: 42 } })).not.toHaveProperty('message')
  })
})

describe('handleError, after the lift', () => {
  it("shows a route's own reason instead of the generic message", () => {
    const body = { data: null, error: { message: 'This workspace is on the Pro plan. Cancel the plan in Billing first.' }, code: 409 }
    expect(thrownMessage(liftErrorMessage(body))).toBe('This workspace is on the Pro plan. Cancel the plan in Billing first.')
  })

  it('used to lose it: the body as routes send it, unlifted', () => {
    // The regression this pins: without the lift, the same body produces the
    // generic message, which is what the Delete organization toast said.
    expect(thrownMessage({ data: null, error: { message: 'reason' }, code: 405 })).not.toBe('reason')
  })
})
