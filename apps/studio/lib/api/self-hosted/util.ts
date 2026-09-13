import { constructHeaders } from '../apiHelpers'
import crypto from 'crypto-js'

import {
  ENCRYPTION_KEY,
  POSTGRES_DATABASE,
  POSTGRES_HOST,
  POSTGRES_PASSWORD,
  POSTGRES_PORT,
  POSTGRES_USER_READ_ONLY,
  POSTGRES_USER_READ_WRITE,
} from './constants'
import { IS_PLATFORM } from '@/lib/constants'
import { credentialForRef, perAppCredentialsEnabled } from '@/lib/taskclan/db-credential'

/**
 * Asserts that the current environment is self-hosted.
 */
export function assertSelfHosted() {
  if (IS_PLATFORM) {
    throw new Error('This function can only be called in self-hosted environments')
  }
}

export function encryptString(stringToEncrypt: string): string {
  return crypto.AES.encrypt(stringToEncrypt, ENCRYPTION_KEY).toString()
}

export function getConnectionString({ readOnly }: { readOnly: boolean }) {
  const postgresUser = readOnly ? POSTGRES_USER_READ_ONLY : POSTGRES_USER_READ_WRITE

  return `postgresql://${postgresUser}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DATABASE}`
}

/**
 * The connection for a specific app, falling back to the process-wide one only
 * when per-app credentials are switched off entirely.
 *
 * The fallback is deliberately all-or-nothing. Falling back *per request* —
 * "this app has no credential, use the shared one" — is the bug this exists to
 * prevent: the editor would work, and it would be pointed at the database
 * holding cloud_api_keys. Configured-but-missing throws instead, so the screen
 * says why.
 */
export async function getConnectionStringForRef({
  readOnly,
  ref,
}: {
  readOnly: boolean
  ref?: string
}): Promise<string> {
  if (!perAppCredentialsEnabled() || !ref) {
    // Plain self-hosted Studio, exactly as upstream behaves.
    return getConnectionString({ readOnly })
  }

  const result = await credentialForRef(ref)
  if (result.ok) return result.connectionString

  throw new Error(
    `No database connection for "${ref}": ${result.detail}. ` +
      `Provision a scoped role with scripts/provision-studio-role, or unset ` +
      `TASKCLAN_CLOUD_API_KEY to use the shared connection.`
  )
}

/**
 * Headers for a pg-meta proxy call, carrying the app's own connection.
 *
 * The `[ref]` pg-meta routes forward `x-connection-encrypted` when the incoming
 * request has it — but a browser never sends it, so nothing was setting it and
 * every one of them fell through to the process-wide connection. The Table
 * editor for any app therefore listed the SHARED database's tables, which is
 * the database holding cloud_api_keys.
 *
 * Building it here rather than at ten call sites means a new pg-meta route gets
 * the behaviour by importing this, instead of by remembering to.
 */
export async function pgMetaHeaders(
  req: { headers: Record<string, unknown>; query: Record<string, unknown> },
  opts: { readOnly?: boolean } = {},
): Promise<Record<string, string>> {
  const base = constructHeaders(req.headers as { [prop: string]: unknown }) as Record<string, string>
  const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
  const connectionString = await getConnectionStringForRef({ readOnly: opts.readOnly ?? true, ref })
  return { ...base, 'x-connection-encrypted': encryptString(connectionString) }
}
