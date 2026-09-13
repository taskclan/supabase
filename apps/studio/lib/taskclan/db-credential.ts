/**
 * The database connection for one Taskclan app.
 *
 * Upstream resolves a single `STUDIO_PG_META_URL` for the whole instance, so
 * every project's Table editor and SQL editor point at the same database. With
 * one database per project that is fine. With twenty-one apps sharing one, it
 * means a customer's SQL editor is pointed at the database holding
 * `cloud_api_keys` — which is why the database screens could not ship.
 *
 * Each app now has a Postgres role granted only its own tables, and the
 * connection string for it lives on that app's Cloud site as
 * `STUDIO_DATABASE_URL`. The engine hands it over at
 * `GET /api/cloud/v1/sites/{id}/db-credential`, gated on `write_env`.
 *
 * What makes this safe is not this file. Connect with gamenova's role and
 * `cloud_api_keys` answers `42501 permission denied` — Postgres refuses,
 * whatever Studio asks for. This module only has to fetch the right string and
 * fail closed when it cannot.
 */
import { taskclanConfig } from './client'
import { findSiteByRef, type CloudSite } from './projects'

/** Beyond this we stop rather than hold a dashboard request open. */
const TIMEOUT_MS = 8000

/**
 * Cached per ref for the life of the process.
 *
 * A credential fetch on every query would put a network round trip in front of
 * every keystroke in the SQL editor. Rotating a role's password therefore needs
 * a Studio restart — an acceptable trade for a value that changes about never,
 * and noted here so the next person is not puzzled.
 */
const cache = new Map<string, string>()

/** Tests only. */
export function resetCredentialCache(): void {
  cache.clear()
}

export type CredentialResult =
  | { ok: true; connectionString: string }
  | { ok: false; reason: 'not_configured' | 'no_such_app' | 'unauthorized' | 'http_error' | 'network_error'; detail: string }

async function siteIdForRef(ref: string, cfg: { url: string; key: string }): Promise<string | null> {
  const res = await fetch(`${cfg.url}/api/cloud/v1/sites`, {
    headers: { authorization: `Bearer ${cfg.key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { sites?: CloudSite[] }
  // The same picker the project handlers use, so an app cannot resolve to one
  // id for its page and a different one for its database.
  return findSiteByRef(Array.isArray(body.sites) ? body.sites : [], ref)?.id ?? null
}

/**
 * The scoped connection string for `ref`, or why there isn't one.
 *
 * Never falls back to the process-wide URL. That fallback is the whole bug:
 * it would silently point one app's SQL editor at the shared database, and the
 * editor would work — which is worse than it refusing.
 */
export async function credentialForRef(ref: string): Promise<CredentialResult> {
  const cached = cache.get(ref)
  if (cached) return { ok: true, connectionString: cached }

  const cfg = taskclanConfig()
  if (!cfg.ok) return { ok: false, reason: 'not_configured', detail: cfg.reason }

  try {
    const siteId = await siteIdForRef(ref, cfg.config)
    if (!siteId) return { ok: false, reason: 'no_such_app', detail: `no Taskclan app matches "${ref}"` }

    const res = await fetch(`${cfg.config.url}/api/cloud/v1/sites/${siteId}/db-credential`, {
      headers: { authorization: `Bearer ${cfg.config.key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'unauthorized', detail: `the Cloud API key cannot read ${ref}'s database credential` }
    }
    if (res.status === 404) {
      // The engine distinguishes "no such site" from "no credential set". Both
      // arrive as 404; the body says which, and "not configured" is the normal
      // state for an app that has not been provisioned a role yet.
      const body = (await res.json().catch(() => ({}))) as { configured?: boolean; reason?: string }
      return {
        ok: false,
        reason: 'not_configured',
        detail: body.reason ?? `no database credential configured for "${ref}"`,
      }
    }
    if (!res.ok) {
      return { ok: false, reason: 'http_error', detail: `${res.status} from the Cloud API` }
    }

    const body = (await res.json()) as { connectionString?: string }
    if (!body.connectionString) {
      return { ok: false, reason: 'not_configured', detail: `no connection string returned for "${ref}"` }
    }

    cache.set(ref, body.connectionString)
    return { ok: true, connectionString: body.connectionString }
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Whether per-app credentials are in play at all.
 *
 * When Taskclan is not configured Studio behaves exactly as upstream does —
 * one process-wide connection — which is correct for a plain self-hosted
 * install and keeps this fork rebaseable.
 */
export function perAppCredentialsEnabled(): boolean {
  return taskclanConfig().ok
}
