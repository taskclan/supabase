import { enrichLintsQuery, getLintsSQL } from '@supabase/pg-meta'
import { paths } from 'api-types'

import { executeQuery } from './query'
import { DOCS_URL } from '@/lib/constants'
import type { Caller } from '@/lib/taskclan/callerContext'

interface GetLintsOptions {
  headers?: HeadersInit
  exposedSchemas?: string
  /** The app whose database to lint; without it the process-wide connection is used. */
  ref?: string
  /** Who is asking. Required alongside `ref`. */
  caller?: Caller
}

export async function getLints({ headers, exposedSchemas, ref, caller }: GetLintsOptions) {
  const sql = getLintsSQL({ docsUrl: DOCS_URL })
  return await executeQuery<ResponseData[number]>({
    query: enrichLintsQuery(sql, exposedSchemas),
    headers,
    ref,
    caller,
  })
}

export type ResponseData =
  paths['/platform/projects/{ref}/run-lints']['get']['responses']['200']['content']['application/json']
