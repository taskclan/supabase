/**
 * Deployments for one Taskclan Cloud app.
 *
 * Studio's own project screens are about a database; an app on Taskclan Cloud
 * also has a build pipeline, and until now the only way to ship one was an API
 * call or approving an intent by hand. Everything a deploy needs already exists
 * on the engine — this is the mapping the console needs to drive it.
 *
 * Pure, like ./projects.ts: the fetches live in the API routes that import
 * this, so the interesting decisions (what counts as in-flight, what a person
 * is allowed to press) can be argued with in a test instead of over a network.
 */

/** `GET /api/cloud/v1/sites/{id}/deployments` — one row. */
export interface CloudDeployment {
  id: string
  siteId: string
  status: string
  phase?: string | null
  source?: string | null
  url?: string | null
  commitSha?: string | null
  commitMessage?: string | null
  commitAuthor?: string | null
  branch?: string | null
  target?: string | null
  error?: string | null
  createdAt: string
  finishedAt?: string | null
  durationSec?: number | null
}

export interface BuildStats {
  total?: number
  succeeded?: number
  failed?: number
  avgDurationSec?: number | null
}

/**
 * Deploy states, collapsed to the four a person acts on.
 *
 * The engine emits a longer vocabulary (queued, building, deploying, ready,
 * error, cancelled, superseded...). A console that renders each one literally
 * asks the reader to learn the pipeline's internals to answer "did it ship?".
 */
export type DeployState = 'running' | 'ready' | 'failed' | 'superseded'

const RUNNING = new Set(['queued', 'pending', 'building', 'deploying', 'initializing', 'uploading'])
const FAILED = new Set(['error', 'failed', 'cancelled', 'canceled', 'timed_out'])

export function deployState(status: string | null | undefined): DeployState {
  const s = (status ?? '').toLowerCase()
  if (RUNNING.has(s)) return 'running'
  if (FAILED.has(s)) return 'failed'
  if (s === 'superseded') return 'superseded'
  return 'ready'
}

/** Is a deploy in flight for this app? Drives whether "Deploy" is pressable. */
export function hasDeployInFlight(deployments: readonly CloudDeployment[]): boolean {
  return deployments.some((d) => deployState(d.status) === 'running')
}

/**
 * The most recent deploy that says something about the app's health.
 *
 * `superseded` rows are skipped: a deploy replaced mid-flight is a fact about
 * the queue, not about whether the app works, and surfacing it as the headline
 * makes a healthy app look like it last failed.
 */
export function currentDeployment(
  deployments: readonly CloudDeployment[]
): CloudDeployment | null {
  return deployments.find((d) => deployState(d.status) !== 'superseded') ?? deployments[0] ?? null
}

/** "4m 12s" / "38s" / "—". Deploys here run minutes, so hours are not a case. */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—'
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * Relative time, resolving to a date once "days ago" stops being useful.
 *
 * Takes `now` rather than reading the clock, because a helper that reads the
 * clock cannot be tested and this session has already been misled once by
 * date arithmetic against an assumed clock.
 */
export function formatAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const sec = Math.max(0, Math.round((now.getTime() - t) / 1000))
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`
  return new Date(t).toISOString().slice(0, 10)
}

/** First line of a commit message, trimmed for a table cell. */
export function commitSummary(d: CloudDeployment): string {
  const msg = (d.commitMessage ?? '').split('\n')[0]?.trim()
  if (msg) return msg.length > 72 ? `${msg.slice(0, 71)}…` : msg
  if (d.commitSha) return d.commitSha.slice(0, 7)
  return d.source === 'service' ? 'Redeploy' : 'Deploy'
}

export type DeployMode = 'auto' | 'manual'

/**
 * What the Deploy button should say and whether it is pressable.
 *
 * `manual` is the platform default for all Cloud apps — a merge to main no
 * longer ships — so "Deploy" is the primary action here rather than a rarely
 * used escape hatch.
 */
export function deployAction(
  deployments: readonly CloudDeployment[],
  canDeploy: boolean
): { label: string; disabled: boolean; reason: string | null } {
  if (!canDeploy) {
    return { label: 'Deploy', disabled: true, reason: 'your role cannot deploy to production' }
  }
  if (hasDeployInFlight(deployments)) {
    return { label: 'Deploying…', disabled: true, reason: 'a deploy is already running' }
  }
  return { label: 'Deploy', disabled: false, reason: null }
}
