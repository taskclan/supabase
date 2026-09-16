import * as Sentry from '@sentry/nextjs'

import { constructHeaders } from '../apiHelpers'
import { databaseErrorSchema, PgMetaDatabaseError, WrappedResult } from './types'
import { pgMetaError } from './pgMetaError'
import { assertSelfHosted, encryptString, getConnectionStringForRef } from './util'
import { PG_META_URL } from '@/lib/constants/index'

export type QueryOptions = {
  query: string
  parameters?: unknown[]
  readOnly?: boolean
  headers?: HeadersInit
  /**
   * Which Taskclan app this query belongs to.
   *
   * Optional, and omitting it means the process-wide connection — upstream's
   * behaviour, correct for a single-project install. Handlers that serve a
   * specific project should pass `req.query.ref`, or the query runs against
   * the shared database instead of the app's own.
   */
  ref?: string
}

/**
 * Executes a SQL query against the self-hosted Postgres instance via pg-meta service.
 *
 * _Only call this from server-side self-hosted code._
 */
export async function executeQuery<T = unknown>({
  query,
  parameters,
  readOnly = false,
  headers,
  ref,
}: QueryOptions): Promise<WrappedResult<T[]>> {
  assertSelfHosted()

  // `ref` names the app whose database this query is for. Without it the
  // process-wide connection is used, which is upstream's behaviour and correct
  // for a single-project install.
  const connectionString = await getConnectionStringForRef({ readOnly, ref })
  const connectionStringEncrypted = encryptString(connectionString)

  const requestBody: { query: string; parameters?: unknown[] } = { query }
  if (parameters !== undefined) {
    requestBody.parameters = parameters
  }

  return await Sentry.startSpan({ name: 'pg-meta.query', op: 'db.query' }, async (span) => {
    let response: Response
    try {
      response = await fetch(`${PG_META_URL}/query`, {
        method: 'POST',
        headers: constructHeaders({
          ...headers,
          'Content-Type': 'application/json',
          'x-connection-encrypted': connectionStringEncrypted,
        }),
        body: JSON.stringify(requestBody),
      })
    } catch (cause) {
      // pg-meta did not answer at all — not running, refused, DNS, timeout.
      //
      // This fetch used to sit outside any try, so the rejection escaped
      // executeQuery entirely. apiWrapper caught it and JSON.stringify turned
      // the Error into `{}` — an Error has no enumerable own properties — so
      // every database screen got `{"error":{}}` and reported "API error
      // happened while trying to communicate with the server". That names
      // neither the service nor the reason, and points the reader at Restart
      // database / Restart project when the database is not the problem.
      span.setAttribute('db.error', 1)
      const { message } = pgMetaError(
        { message: cause instanceof Error ? cause.message : String(cause) },
        PG_META_URL
      )
      return { data: undefined, error: new Error(message) }
    }

    try {
      const result = await response.json()

      if (!response.ok) {
        const { message, code, formattedError } = databaseErrorSchema.parse(result)
        span.setAttribute('db.error', 1)
        span.setAttribute('db.status_code', response.status)
        const error = new PgMetaDatabaseError(message, code, response.status, formattedError)
        return { data: undefined, error }
      }

      span.setAttribute('db.status_code', response.status)
      return { data: result, error: undefined }
    } catch (error) {
      span.setAttribute('db.error', 1)
      if (error instanceof Error) {
        return { data: undefined, error }
      }
      throw error
    }
  })
}
