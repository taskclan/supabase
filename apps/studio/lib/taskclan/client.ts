/**
 * Server-side client for Taskclan Cloud's API.
 *
 * Used by the `/api/platform/*` handlers so Studio answers from Cloud's real
 * apps instead of its hardcoded stubs. Server-side only — the key must never
 * reach the browser, so nothing here is imported from a component.
 *
 * Auth comes from a `Caller` rather than being read here, because the console
 * now has two kinds. An `sk_cloud_*` API key is right for callers with no user
 * behind them (the deploy probe, CI, the CLI, MCP): it resolves to an org with
 * its own scopes, so org scoping and RBAC stay Cloud's job rather than being
 * reimplemented here. A signed-in browser request carries the person's own
 * Supabase JWT, which Cloud accepts on the same routes.
 *
 * This file used to say a user token was deliberately avoided, because those
 * expire in an hour and a dashboard that stops listing apps is worse than one
 * that never started. That is still true of a token pasted into a server
 * environment variable, which is what it described: nothing refreshes it. It is
 * not true of a browser session, where auth-js refreshes on read, so every
 * request carries a fresh token. The shared key survives for the callers that
 * genuinely have no session; what it stops being is a stand-in for identity.
 */
import { authHeadersFor, type Caller } from './callerContext'
import { findSiteByRef, type CloudSite } from './projects'

const KEY_PREFIX = 'sk_cloud_'

export interface TaskclanConfig {
  url: string
  key: string
}

/**
 * Read the configuration, or say precisely why there isn't one.
 *
 * Returns a reason rather than null so callers can report it. A dashboard
 * quietly falling back to "Default Project" is how someone spends an afternoon
 * wondering why their apps are missing — the same failure mode as a telemetry
 * sink that reports success when unconfigured.
 */
export function taskclanConfig(): { ok: true; config: TaskclanConfig } | { ok: false; reason: string } {
  const url = process.env.TASKCLAN_CLOUD_URL?.trim()
  const key = process.env.TASKCLAN_CLOUD_API_KEY?.trim()
  if (!url && !key) {
    return { ok: false, reason: 'TASKCLAN_CLOUD_URL and TASKCLAN_CLOUD_API_KEY are not set' }
  }
  if (!url) return { ok: false, reason: 'TASKCLAN_CLOUD_URL is not set' }
  if (!key) return { ok: false, reason: 'TASKCLAN_CLOUD_API_KEY is not set' }
  if (!key.startsWith(KEY_PREFIX)) {
    // Catch the likely mistake — pasting a Supabase anon/service key, or a user
    // access token — at startup rather than as a puzzling 401 later.
    return { ok: false, reason: `TASKCLAN_CLOUD_API_KEY does not look like a Cloud API key (expected ${KEY_PREFIX}…)` }
  }
  return { ok: true, config: { url: url.replace(/\/+$/, ''), key } }
}

/**
 * Where Cloud lives, independent of how the request authenticates.
 *
 * A user caller brings its own credential, so it needs the URL without needing
 * a key to be configured at all. Kept separate from `taskclanConfig` so that
 * once the shared key is retired, a missing key stops meaning "not configured".
 */
export function cloudBaseUrl(): { ok: true; url: string } | { ok: false; reason: string } {
  const url = process.env.TASKCLAN_CLOUD_URL?.trim()
  if (!url) return { ok: false, reason: 'TASKCLAN_CLOUD_URL is not set' }
  return { ok: true, url: url.replace(/\/+$/, '') }
}

export function taskclanConfigured(): boolean {
  return taskclanConfig().ok
}

/** Beyond this we give up rather than hold a dashboard request open. */
const TIMEOUT_MS = 8000

export type CloudResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' | 'http_error' | 'network_error'; detail: string }

async function cloudGet<T>(
  path: string,
  caller: Caller,
  pick: (body: unknown) => T
): Promise<CloudResult<T>> {
  const base = cloudBaseUrl()
  if (!base.ok) return { ok: false, reason: 'not_configured', detail: base.reason }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base.url}${path}`, {
      headers: authHeadersFor(caller),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, reason: 'http_error', detail: `${res.status} ${body.slice(0, 200)}` }
    }
    return { ok: true, data: pick(await res.json()) }
  } catch (e) {
    return {
      ok: false,
      reason: 'network_error',
      detail: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * POST to Cloud's API as `caller`.
 *
 * The mirror of cloudGet for the handful of console screens that create things
 * (a new app, an import). Same error vocabulary so callers report a cause
 * rather than a bare failure. `timeoutMs` is a parameter because these are not
 * all alike: reserving a subdomain is quick, kicking off an import less so.
 */
async function cloudPost<T>(
  path: string,
  body: unknown,
  caller: Caller,
  pick: (body: unknown, status: number) => T,
  timeoutMs = TIMEOUT_MS
): Promise<CloudResult<T>> {
  const base = cloudBaseUrl()
  if (!base.ok) return { ok: false, reason: 'not_configured', detail: base.reason }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base.url}${path}`, {
      method: 'POST',
      headers: { ...authHeadersFor(caller), 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // Surface the engine's own message (e.g. "name is required", "your role
      // cannot import apps") rather than a generic status.
      let detail = `${res.status}`
      try {
        const parsed = JSON.parse(text) as { error?: string }
        detail = parsed?.error ? parsed.error : `${res.status} ${text.slice(0, 200)}`
      } catch {
        detail = `${res.status} ${text.slice(0, 200)}`
      }
      return { ok: false, reason: 'http_error', detail }
    }
    return { ok: true, data: pick(await res.json().catch(() => ({})), res.status) }
  } catch (e) {
    return {
      ok: false,
      reason: 'network_error',
      detail: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Create a site (an app) in the key's org.
 *
 * `type` is 'service' | 'static'; the engine coerces anything else to 'static'.
 * Returns the created site so the caller can route to it by its subdomain.
 */
export function createCloudSite(
  input: { name: string; type?: 'service' | 'static' },
  caller: Caller
): Promise<CloudResult<CloudSite>> {
  return cloudPost(
    '/api/cloud/v1/sites',
    { name: input.name, type: input.type ?? 'service' },
    caller,
    (body) => (body as { site?: CloudSite }).site as CloudSite
  )
}

/**
 * Import an app from a GitHub repo (create the site, link the repo, build it).
 *
 * `dbMode:'connect'` means "do not provision a managed database as part of the
 * import" — a dedicated database is provisioned separately (with the tier the
 * form chose) so the two paths share one provisioning code path. Returns the
 * new site's id; the caller resolves its subdomain from the sites list.
 */
export function importCloudApp(
  input: { repo: string; name?: string; branch?: string },
  caller: Caller
): Promise<CloudResult<{ siteId: string }>> {
  return cloudPost(
    '/api/cloud/v1/import/run',
    {
      source: 'generic',
      repo: input.repo,
      name: input.name,
      branch: input.branch,
      dbMode: 'connect',
      generic: { envText: '' },
    },
    caller,
    (body) => {
      const r = (body as { result?: { siteId?: string } }).result
      return { siteId: r?.siteId ?? '' }
    },
    // An import kicks off a build; the route answers 202 once queued, but give
    // it more room than a plain GET.
    20000
  )
}

/** The org's apps. Scoped by the API key's org — this cannot see another org's. */
export function listCloudSites(caller: Caller): Promise<CloudResult<CloudSite[]>> {
  return cloudGet('/api/cloud/v1/sites', caller, (body) => {
    const sites = (body as { sites?: unknown })?.sites
    return Array.isArray(sites) ? (sites as CloudSite[]) : []
  })
}

/** The org the key belongs to, for the organization handler. */
export interface CloudOrg {
  id: string
  name: string
  /** The engine's own slug. Studio routes org URLs on it, so it must not be re-derived. */
  slug?: string
}

/** Every org the caller belongs to, and which one is active. */
export function listCloudOrgs(
  caller: Caller
): Promise<CloudResult<{ orgs: CloudOrg[]; activeOrgId: string | null }>> {
  return cloudGet('/api/cloud/v1/orgs', caller, (body) => {
    const b = body as { orgs?: CloudOrg[]; activeOrgId?: string }
    return {
      orgs: Array.isArray(b?.orgs) ? b.orgs : [],
      activeOrgId: typeof b?.activeOrgId === 'string' ? b.activeOrgId : null,
    }
  })
}

/** The caller's active org. */
export async function getCloudOrg(caller: Caller): Promise<CloudResult<CloudOrg | null>> {
  const result = await listCloudOrgs(caller)
  if (!result.ok) return result
  const { orgs, activeOrgId } = result.data
  if (!orgs.length) return { ok: true, data: null }
  return { ok: true, data: orgs.find((o) => o.id === activeOrgId) ?? orgs[0] }
}

/**
 * The caller's app matching `ref`.
 *
 * Folded into one place from the seven routes that each had their own copy.
 * Resolving the ref against the caller's OWN site list is what makes a ref
 * belonging to another org return nothing, so this is the tenancy check as much
 * as it is a lookup, and it should not be reimplemented per route again.
 *
 * Returns a result rather than `CloudSite | null` so that "looked, and there is
 * no such app" stays distinct from "could not look". Collapsing them tells
 * somebody their app does not exist when Cloud is merely unreachable, which
 * reads as data loss and sends them looking in the wrong place.
 */
export async function siteForCaller(
  ref: string,
  caller: Caller
): Promise<CloudResult<CloudSite | null>> {
  const result = await listCloudSites(caller)
  if (!result.ok) return result
  // The same picker the project handlers use, so an app cannot resolve to one
  // id for its page and a different one for its database.
  return { ok: true, data: findSiteByRef(result.data, ref) ?? null }
}
