/**
 * Server-side client for Taskclan Cloud's API.
 *
 * Used by the `/api/platform/*` handlers so Studio answers from Cloud's real
 * apps instead of its hardcoded stubs. Server-side only — the key must never
 * reach the browser, so nothing here is imported from a component.
 *
 * Auth is an `sk_cloud_*` API key, which Cloud already supports for CLI, MCP
 * and CI callers: it resolves to an org with its own scopes, so org scoping
 * and RBAC stay Cloud's job rather than being reimplemented here. Deliberately
 * NOT a user access token — those live 60 minutes, and a dashboard that stops
 * listing apps an hour after someone set it up is worse than one that never
 * started.
 */
import { CloudSite } from './projects'

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

export function taskclanConfigured(): boolean {
  return taskclanConfig().ok
}

/** Beyond this we give up rather than hold a dashboard request open. */
const TIMEOUT_MS = 8000

export type CloudResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' | 'http_error' | 'network_error'; detail: string }

async function cloudGet<T>(path: string, pick: (body: unknown) => T): Promise<CloudResult<T>> {
  const cfg = taskclanConfig()
  if (!cfg.ok) return { ok: false, reason: 'not_configured', detail: cfg.reason }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${cfg.config.url}${path}`, {
      headers: { authorization: `Bearer ${cfg.config.key}`, accept: 'application/json' },
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
 * POST to Cloud's API with the org key.
 *
 * The mirror of cloudGet for the handful of console screens that create things
 * (a new app, an import). Same error vocabulary so callers report a cause
 * rather than a bare failure. `timeoutMs` is a parameter because these are not
 * all alike: reserving a subdomain is quick, kicking off an import less so.
 */
async function cloudPost<T>(
  path: string,
  body: unknown,
  pick: (body: unknown, status: number) => T,
  timeoutMs = TIMEOUT_MS
): Promise<CloudResult<T>> {
  const cfg = taskclanConfig()
  if (!cfg.ok) return { ok: false, reason: 'not_configured', detail: cfg.reason }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${cfg.config.url}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.config.key}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
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
export function createCloudSite(input: {
  name: string
  type?: 'service' | 'static'
}): Promise<CloudResult<CloudSite>> {
  return cloudPost(
    '/api/cloud/v1/sites',
    { name: input.name, type: input.type ?? 'service' },
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
export function importCloudApp(input: {
  repo: string
  name?: string
  branch?: string
}): Promise<CloudResult<{ siteId: string }>> {
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
export function listCloudSites(): Promise<CloudResult<CloudSite[]>> {
  return cloudGet('/api/cloud/v1/sites', (body) => {
    const sites = (body as { sites?: unknown })?.sites
    return Array.isArray(sites) ? (sites as CloudSite[]) : []
  })
}

/** The org the key belongs to, for the organization handler. */
export function getCloudOrg(): Promise<CloudResult<{ id: string; name: string } | null>> {
  return cloudGet('/api/cloud/v1/orgs', (body) => {
    const b = body as { orgs?: Array<{ id: string; name: string }>; activeOrgId?: string }
    const orgs = Array.isArray(b?.orgs) ? b.orgs : []
    if (!orgs.length) return null
    return orgs.find((o) => o.id === b?.activeOrgId) ?? orgs[0]
  })
}
