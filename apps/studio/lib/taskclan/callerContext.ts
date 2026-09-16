/**
 * Who a server route is acting as when it calls Taskclan Cloud.
 *
 * The console started with one answer: a single org-scoped `sk_cloud_*` key,
 * read from the environment, used for every request from every visitor. That
 * is correct for an internal tool behind one shared password, and wrong the
 * moment two customers can sign in, because the key IS the tenancy scope. Two
 * users sharing a key see one org's apps, whoever they are.
 *
 * So routes stop reading the key directly and resolve a `Caller` instead. A
 * signed-in browser request carries the user's own Supabase JWT, which the
 * engine already accepts: `resolveCloudOrgFromRequest` branches on the bearer,
 * sending `sk_cloud_*` down the API-key path and anything else to
 * `requireUser`. Scoping therefore stays the engine's job either way, which is
 * the property worth preserving.
 *
 * The shared key does not go away. It is still right for callers that have no
 * user behind them: the deploy probe, CI, the CLI, MCP. What it stops being is
 * a substitute for identity on a browser request.
 */
import { taskclanConfig } from './client'

/**
 * The part of a request this needs.
 *
 * Structural rather than `NextApiRequest`, so the pg-meta helpers can pass the
 * narrowed request shape they already accept without widening it back.
 */
export interface AuthenticatableRequest {
  headers: Record<string, unknown>
  url?: string
}

/** The `sk_cloud_*` prefix, duplicated from client.ts intentionally: see `callerFromRequest`. */
const CLOUD_KEY_PREFIX = 'sk_cloud_'

export type Caller =
  /** A signed-in person. `org` selects which of their orgs to act in. */
  | { kind: 'user'; token: string; org: string | null }
  /** No user. The console's own org-scoped key. */
  | { kind: 'shared'; key: string }

export type CallerResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: 401 | 501; reason: string }

/**
 * Whether a request with no user may fall back to the shared key.
 *
 * A runtime variable rather than a build-time one, deliberately. Turning auth
 * on requires a rebuild (the `NEXT_PUBLIC_*` values are inlined), but turning
 * the old path back on must not: this is the rollback lever, and a rebuild is
 * a slow way to recover a console that is refusing every request.
 */
function sharedKeyFallbackAllowed(): boolean {
  return process.env.TASKCLAN_SHARED_KEY_FALLBACK !== 'false'
}

function bearerToken(req: AuthenticatableRequest): string | null {
  const header = req.headers.authorization
  if (typeof header !== 'string') return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

/**
 * Resolve who this request is acting as.
 *
 * A bearer token wins over the shared key, so a signed-in visitor is always
 * scoped to themselves even while the fallback is still enabled during the
 * auth rollout.
 *
 * An `sk_cloud_*` value arriving as a browser bearer is rejected rather than
 * honoured. Accepting it would let anyone who learned a key inherit its org
 * through the console, which is the exact privilege the rollout is removing.
 * The engine would accept it happily, which is why the check belongs here: the
 * distinction being drawn is "a browser request" versus "a server caller", and
 * only this side knows which it is holding.
 */
export function callerFromRequest(req: AuthenticatableRequest): CallerResult {
  const token = bearerToken(req)

  if (token) {
    if (token.startsWith(CLOUD_KEY_PREFIX)) {
      return {
        ok: false,
        status: 401,
        reason: 'a Cloud API key cannot be used as a browser credential',
      }
    }
    // Read only the current header. The engine also accepts a legacy
    // `x-hivemind-org`, but this console has no sessions predating the rename,
    // so honouring it here would only widen what an attacker can set.
    const org = req.headers['x-taskclan-org']
    return {
      ok: true,
      caller: { kind: 'user', token, org: typeof org === 'string' && org ? org : null },
    }
  }

  if (!sharedKeyFallbackAllowed()) {
    return { ok: false, status: 401, reason: 'sign in to use this console' }
  }

  const cfg = taskclanConfig()
  if (!cfg.ok) return { ok: false, status: 501, reason: cfg.reason }

  // Loud on purpose. Once auth is on, every one of these is a request that
  // should have carried a user and did not, and the only place that is visible
  // is the Worker's log.
  console.warn('[taskclan] falling back to the shared Cloud key for %s', req.url ?? 'a request')
  return { ok: true, caller: { kind: 'shared', key: cfg.config.key } }
}

/** The headers that authenticate `caller` to the engine. */
export function authHeadersFor(caller: Caller): Record<string, string> {
  if (caller.kind === 'shared') {
    return { authorization: `Bearer ${caller.key}`, accept: 'application/json' }
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${caller.token}`,
    accept: 'application/json',
  }
  if (caller.org) headers['x-taskclan-org'] = caller.org
  return headers
}

/**
 * A stable key for anything cached per tenant.
 *
 * Cache keys that omit this are how one tenant reads another's data: a map
 * keyed by app ref alone is process-wide and shared by every visitor.
 *
 * Partitioned by the token's `sub` claim rather than the token itself, for two
 * reasons. The access token rotates roughly hourly, so keying on it would empty
 * the cache on every refresh and defeat the point. And a cache key is a poor
 * place to keep credential material.
 *
 * The claim is read without verifying the signature, which is safe for this
 * use: the value only chooses a cache partition, and the engine still validates
 * the token on the call itself. A forged `sub` buys a different partition and
 * nothing else.
 *
 * Unreadable tokens share one partition. Nothing can be cached there, because a
 * token that will not parse here will not authenticate at the engine either, so
 * the lookup fails before it reaches a write.
 */
export function cacheScopeFor(caller: Caller): string {
  if (caller.kind === 'shared') return 'shared'
  const subject = subjectOf(caller.token)
  return `user:${subject}:${caller.org ?? 'default'}`
}

/** The `sub` claim, or a stable stand-in when the token cannot be read. */
function subjectOf(token: string): string {
  const payload = token.split('.')[1]
  if (!payload) return 'unreadable'
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const sub = (JSON.parse(json) as { sub?: unknown }).sub
    return typeof sub === 'string' && sub ? sub : 'unreadable'
  } catch {
    return 'unreadable'
  }
}
