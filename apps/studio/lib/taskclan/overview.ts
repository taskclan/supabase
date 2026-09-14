/**
 * The Overview a Taskclan Cloud app can honestly show.
 *
 * Upstream's home page renders status, compute, region, backups and migrations
 * — but all of it behind IS_PLATFORM, so a self-hosted console shows only the
 * project title. This is the data that replaces that emptiness with what is
 * actually true of a Taskclan app.
 *
 * Deliberately NOT a clone of the Supabase card set. A Taskclan app is a
 * container plus a role in a shared database, so "last backup" and "last
 * migration" of a per-app database do not exist — rendering them would be a
 * plausible-looking lie. What IS true: whether it is deployed and healthy, what
 * it runs on, where its code comes from, and when it last shipped.
 *
 * Pure, like ./projects.ts and ./deployments.ts: the fetch lives in the API
 * route, so the mapping can be tested without a network.
 */
import { deployState, type CloudDeployment, type DeployState } from './deployments'

/** `GET /api/cloud/v1/sites/{id}` — the fields the overview reads. */
export interface CloudSiteDetail {
  id: string
  name: string
  host?: string | null
  customDomain?: string | null
  status?: string | null
  type?: string | null
  instanceType?: string | null
  maxInstances?: number | null
  region?: string | null
  deployMode?: string | null
  createdAt?: string | null
}

export interface CloudGit {
  repoFullName?: string | null
  branch?: string | null
  rootDir?: string | null
}

export interface Overview {
  name: string
  liveUrl: string | null
  status: { label: string; tone: 'healthy' | 'warning' | 'down' | 'neutral' }
  compute: string
  region: string
  repo: string | null
  branch: string | null
  deployMode: 'auto' | 'manual'
  lastDeploy: {
    state: DeployState
    commit: string | null
    when: string | null
    durationSec: number | null
  } | null
}

/** The container's health, as a badge. Mirrors what the deploy list already shows. */
function statusOf(site: CloudSiteDetail, latest: CloudDeployment | null): Overview['status'] {
  // A failed last deploy is the loudest fact, even if the previous release is
  // still serving — it is the thing someone opened this page to see.
  if (latest && deployState(latest.status) === 'failed') {
    return { label: 'Last deploy failed', tone: 'warning' }
  }
  const s = (site.status ?? '').toLowerCase()
  if (s === 'active' || s === 'healthy') return { label: 'Healthy', tone: 'healthy' }
  if (s === 'inactive' || s === 'paused' || s === 'suspended')
    return { label: 'Paused', tone: 'neutral' }
  if (!s) return { label: 'Unknown', tone: 'neutral' }
  return { label: site.status as string, tone: 'warning' }
}

/**
 * Container instance type, in the platform's own words.
 *
 * Not translated to Supabase's NANO/MICRO/SMALL: those name a database compute
 * tier, and a Taskclan app is billed on a container tier (lite, basic,
 * standard-1). Showing "NANO" would borrow a scale that does not apply.
 */
function computeOf(site: CloudSiteDetail): string {
  const t = (site.instanceType ?? '').trim()
  if (!t) return '—'
  const n = site.maxInstances ?? 1
  return n > 1 ? `${t} ×${n}` : t
}

function regionOf(site: CloudSiteDetail): string {
  const r = (site.region ?? '').trim()
  if (!r || r === 'auto') return 'Auto'
  return r
}

export function buildOverview(
  site: CloudSiteDetail,
  git: CloudGit | null,
  deployments: readonly CloudDeployment[]
): Overview {
  // The newest non-superseded deploy — the same choice the deploy list makes,
  // so the two screens never disagree about what is live.
  const latest =
    deployments.find((d) => deployState(d.status) !== 'superseded') ?? deployments[0] ?? null

  return {
    name: site.name,
    liveUrl: site.customDomain
      ? `https://${site.customDomain}`
      : site.host
        ? `https://${site.host}`
        : null,
    status: statusOf(site, latest),
    compute: computeOf(site),
    region: regionOf(site),
    repo: git?.repoFullName ?? null,
    branch: git?.branch ?? latest?.branch ?? null,
    deployMode: site.deployMode === 'auto' ? 'auto' : 'manual',
    lastDeploy: latest
      ? {
          state: deployState(latest.status),
          commit:
            (latest.commitMessage ?? '').split('\n')[0]?.trim() ||
            (latest.commitSha ? latest.commitSha.slice(0, 7) : null),
          when: latest.createdAt ?? null,
          durationSec: latest.durationSec ?? null,
        }
      : null,
  }
}
