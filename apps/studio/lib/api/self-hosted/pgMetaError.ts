/**
 * How a failed pg-meta proxy call should be reported.
 *
 * `ResponseError.code` is optional, and undefined is the common case rather
 * than a corner one: it means the request never got a response at all —
 * pg-meta not running, connection refused, DNS, timeout. The `[ref]` routes
 * passed it straight to `res.status(code)`, which throws
 * ERR_HTTP_INVALID_STATUS_CODE. The route then 500s with a Node error code in
 * the body and no message, so the Table editor can only say "API error happened
 * while trying to communicate with the server" — which reads as a database
 * problem and sends the reader to Restart database / Restart project, neither
 * of which is the cause.
 *
 * 502 is the honest status: this route is a proxy and its upstream did not
 * answer. Saying which upstream, and where it was expected, is the part that
 * turns the screen back into something actionable.
 *
 * Pure so it can be tested without a server: the defect only appears when
 * pg-meta is absent, which is awkward to arrange in a running app and trivial
 * here.
 */

/** Outside this range `res.status()` throws rather than responding. */
const MIN_STATUS = 100
const MAX_STATUS = 599

/** A proxy whose upstream did not respond. */
export const UPSTREAM_UNREACHABLE = 502

export interface PgMetaFailure {
  code?: number
  message?: string
}

/**
 * `pgMetaUrl` is `string | undefined` because STUDIO_PG_META_URL is optional.
 * Unset is its own diagnosis — nothing was even attempted — and saying so beats
 * printing "undefined" into the middle of an address.
 */
export function pgMetaError(
  error: PgMetaFailure,
  pgMetaUrl: string | undefined
): { status: number; message: string } {
  const { code, message } = error

  const isUsableStatus =
    typeof code === 'number' &&
    Number.isInteger(code) &&
    code >= MIN_STATUS &&
    code <= MAX_STATUS

  if (isUsableStatus) {
    // pg-meta answered and said no. Its own message is the useful one.
    return { status: code, message: message ?? 'pg-meta returned an error' }
  }

  // No response. Name the service and the address, because the two ways to be
  // here are "pg-meta is not running" and "it is running somewhere else", and
  // the address distinguishes them.
  const detail = message ? ` (${message})` : ''
  const where = pgMetaUrl
    ? `Could not reach pg-meta at ${pgMetaUrl}${detail}.`
    : `STUDIO_PG_META_URL is not set, so there is no pg-meta to reach${detail}.`

  return {
    status: UPSTREAM_UNREACHABLE,
    message:
      `${where} The database screens proxy through it, so they need it running. ` +
      `In deployed containers it starts alongside the console; locally, start it yourself.`,
  }
}
