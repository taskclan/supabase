/**
 * Move a failed response's reason to where the dashboard looks for it.
 *
 * Studio's `handleError` (data/fetchers.ts) reads `msg` or `message` at the top
 * of an error body. Our own `/api/platform/*` and `/api/v1/*` routes answer
 * `{ data: null, error: { message } }` (162 places in 68 files), and Taskclan
 * Cloud answers `{ error: '...' }`, so neither reason was ever found. Every one
 * of those failures toasted "API error happened while trying to communicate
 * with the server". Delete organization answered 405 behind exactly that toast
 * for as long as it existed.
 *
 * Copies the reason up and never replaces one: a body that already has `msg` or
 * `message` is left alone, and nothing is removed, so a reader of `error`
 * still finds it there.
 */
export function liftErrorMessage<T>(body: T): T {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const b = body as Record<string, unknown>
  if (typeof b.msg === 'string' && b.msg) return body
  if (typeof b.message === 'string' && b.message) return body

  const error = b.error
  const reason =
    // OAuth-style `{ error: 'invalid_request', error_description: 'Missing ...' }`:
    // the description is the sentence; the code is for machines.
    (typeof b.error_description === 'string' && b.error_description) ||
    (typeof error === 'string' && error) ||
    (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '')
  if (reason) b.message = reason
  return body
}
