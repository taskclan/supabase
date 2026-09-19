/**
 * Per-user Cloud session for the console (multi-tenant signup, P1).
 *
 * The console is single-tenant today: every engine call uses one global
 * `sk_cloud` key from the environment. To become multi-tenant, each logged-in
 * user gets their OWN org-scoped `sk_cloud` key (minted by the engine's
 * `/api/cloud/v1/auth/web-session` after a Supabase login) and we hold it here,
 * server-side, in an encrypted httpOnly cookie.
 *
 * The key is a secret. It is AES-256-GCM sealed under `TASKCLAN_SESSION_SECRET`
 * and only ever lives in an httpOnly, Secure, SameSite=Lax cookie — never in a
 * response body, never readable by browser JS. `readCloudSession` is the single
 * server-side reader; P2 makes `taskclanConfig` prefer it over the global key.
 *
 * Nothing here changes existing behavior: the cookie is only ever set by the
 * session route, which is itself behind the signup feature flag.
 */
import crypto from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

export const CLOUD_SESSION_COOKIE = 'tc_cloud_session'

export interface CloudSession {
  /** Org-scoped sk_cloud key. Secret — never leaves the server. */
  key: string
  orgId: string
  orgName?: string
}

/** 32-byte AES key derived from the configured secret (sha256 normalizes length). */
function sessionKeyBytes(): Buffer | null {
  const secret = process.env.TASKCLAN_SESSION_SECRET?.trim()
  if (!secret || secret.length < 16) return null
  return crypto.createHash('sha256').update(secret).digest()
}

/** Seal a session into an opaque cookie value: base64url(iv | tag | ciphertext). */
export function sealCloudSession(session: CloudSession): string | null {
  const keyBytes = sessionKeyBytes()
  if (!keyBytes) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv)
  const plaintext = Buffer.from(JSON.stringify(session), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

/** Unseal a cookie value back to a session, or null if absent/tampered/misconfigured. */
export function unsealCloudSession(value: string | undefined | null): CloudSession | null {
  if (!value) return null
  const keyBytes = sessionKeyBytes()
  if (!keyBytes) return null
  try {
    const raw = Buffer.from(value, 'base64url')
    if (raw.length < 12 + 16 + 1) return null
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const ciphertext = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plaintext) as CloudSession
    if (!parsed || typeof parsed.key !== 'string' || typeof parsed.orgId !== 'string') return null
    return parsed
  } catch {
    // Tampered, wrong secret, or malformed — treat as no session.
    return null
  }
}

/** The current user's Cloud session, or null. The one server-side reader. */
export function readCloudSession(req: NextApiRequest): CloudSession | null {
  return unsealCloudSession(req.cookies?.[CLOUD_SESSION_COOKIE])
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 days

/** Set the sealed session cookie on the response (httpOnly, Secure, Lax). */
export function setCloudSessionCookie(res: NextApiResponse, session: CloudSession): boolean {
  const sealed = sealCloudSession(session)
  if (!sealed) return false
  res.setHeader('Set-Cookie', serializeCookie(CLOUD_SESSION_COOKIE, sealed, COOKIE_MAX_AGE_SECONDS))
  return true
}

/** Clear the session cookie. */
export function clearCloudSessionCookie(res: NextApiResponse): void {
  res.setHeader('Set-Cookie', serializeCookie(CLOUD_SESSION_COOKIE, '', 0))
}

/**
 * Serialize a Set-Cookie header. Hand-rolled rather than pulling `cookie` in, to
 * keep the secret path dependency-free and the attributes explicit.
 */
function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (maxAgeSeconds === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  return parts.join('; ')
}
