/**
 * Release intents: what the deploy agents decided, and what is waiting on a
 * person.
 *
 * Every push to a connected repo opens an intent per mapped app. Most resolve
 * themselves. The ones that matter here are the held ones, because an app on
 * manual deploy mode opens a release and then waits, silently, until somebody
 * approves it. Without a screen for that the only symptom is a merge that never
 * shipped, which reads as a broken pipeline rather than a queue.
 *
 * The mapping and the vocabulary come from the engine
 * (src/lib/cloud/agents/{scout,policy,store}.ts). Kept as pure functions so the
 * interesting cases are tested without a browser: a partly-signed two-approver
 * release, and an approval whose build then failed to start.
 */

export type IntentStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'declined'
  | 'superseded'
  | 'expired'

export interface RuleEvaluation {
  rule: string
  title: string
  detail?: string
  verdict: 'satisfied' | 'needs_human' | string
}

export interface IntentApproval {
  userId?: string
  name?: string
  at?: string
  note?: string
}

export interface ReleaseIntent {
  id: string
  ref: string
  siteId: string
  status: IntentStatus | string
  commitSha?: string | null
  commitMessage?: string | null
  commitAuthor?: string | null
  branch?: string | null
  riskScore?: number | null
  riskFactors?: Array<{ code?: string; label?: string; weight?: number }> | null
  policyEval?: RuleEvaluation[] | null
  approvals?: IntentApproval[] | null
  declineReason?: string | null
  deploymentId?: string | null
  changedPaths?: string[] | null
  createdAt?: string | null
  expiresAt?: string | null
}

/**
 * How many signatures this intent needs.
 *
 * Transcribed from the engine's approversRequired: a schema change wants two,
 * anything else that needs a human wants one. Computed from the stored
 * evaluation rather than carried on the intent, exactly as the engine does, so
 * the two cannot drift.
 */
export function approversRequired(intent: ReleaseIntent): number {
  const needs = (intent.policyEval ?? []).filter((r) => r.verdict === 'needs_human')
  if (needs.length === 0) return 0
  return needs.some((r) => r.rule.endsWith('.schema_change')) ? 2 : 1
}

export function approvalsGiven(intent: ReleaseIntent): number {
  return (intent.approvals ?? []).length
}

/** Whether approve/decline apply at all. The engine 409s on anything else. */
export function isDecidable(intent: ReleaseIntent): boolean {
  return intent.status === 'awaiting_approval'
}

/**
 * The reasons a release is held, in the engine's own words.
 *
 * "Held for approval" with no reason is what makes people distrust a gate and
 * go looking for a way round it, which is the engine's stated reason for
 * modelling these as rules rather than a flag.
 */
export function holdReasons(intent: ReleaseIntent): RuleEvaluation[] {
  return (intent.policyEval ?? []).filter((r) => r.verdict === 'needs_human')
}

export type RiskBand = 'low' | 'medium' | 'high'

export function riskBand(score: number | null | undefined): RiskBand {
  const s = typeof score === 'number' ? score : 0
  if (s >= 0.66) return 'high'
  if (s >= 0.33) return 'medium'
  return 'low'
}

/** The deployment an intent produced, when we have it (the detail endpoint). */
export interface IntentDeployment {
  status?: string | null
  url?: string | null
}

/**
 * One line saying where this release stands.
 *
 * Two things here come from watching real data rather than from the engine's
 * type, and both would otherwise have shipped a confident lie.
 *
 * `executing` is terminal in practice. Nothing moves an intent on to
 * `succeeded` — across sixty live intents the statuses were awaiting_approval,
 * executing, declined, superseded and expired, with no succeeded and no failed.
 * So an intent sits at `executing` forever while its deployment goes ready.
 * Rendering that as "Building" means a finished release reads as stuck. When
 * the deployment is known it is the better source of truth; when it is not, the
 * honest wording is that the build *started*, which stays true either way.
 *
 * And `expired` is a real status the engine sets on held releases nobody got to.
 * It was missing from the type entirely, so it would have fallen through to
 * printing the raw word at the user.
 */
export function statusSummary(intent: ReleaseIntent, deployment?: IntentDeployment | null): string {
  const given = approvalsGiven(intent)
  const required = approversRequired(intent)
  switch (intent.status) {
    case 'awaiting_approval':
      if (isExpired(intent)) return 'Expired before anyone approved it'
      return required > 1
        ? `Waiting for ${required - given} more of ${required} approvals`
        : 'Waiting for approval'
    case 'approved':
      // Reachable when the grant landed but the build failed to start; the
      // engine leaves the intent here rather than pretending it shipped.
      return 'Approved, but the build has not started'
    case 'executing':
      if (deployment?.status === 'ready') return 'Released'
      if (deployment?.status === 'error' || deployment?.status === 'failed') return 'Build failed'
      return 'Build started'
    case 'succeeded':
      return 'Released'
    case 'failed':
      return 'Build failed'
    case 'declined':
      return intent.declineReason ? `Declined: ${intent.declineReason}` : 'Declined'
    case 'superseded':
      return intent.declineReason ?? 'Superseded by a newer commit'
    case 'expired':
      return 'Expired before anyone approved it'
    default:
      return String(intent.status)
  }
}

/**
 * Three buckets, because only one of them is a to-do list.
 *
 * Superseded and declined intents stay visible rather than being hidden: "why
 * didn't my merge deploy?" is answered by a decline, and dropping them from the
 * screen removes the answer.
 */
export interface GroupedIntents {
  waiting: ReleaseIntent[]
  active: ReleaseIntent[]
  closed: ReleaseIntent[]
}

export function groupIntents(intents: ReleaseIntent[]): GroupedIntents {
  const waiting: ReleaseIntent[] = []
  const active: ReleaseIntent[] = []
  const closed: ReleaseIntent[] = []
  for (const i of intents) {
    if (i.status === 'awaiting_approval' && !isExpired(i)) waiting.push(i)
    else if (i.status === 'approved' || i.status === 'executing') active.push(i)
    else closed.push(i)
  }
  return { waiting, active, closed }
}

/** Short commit for display; the engine stores full SHAs. */
export function shortSha(sha: string | null | undefined): string {
  return (sha ?? '').slice(0, 7)
}

/**
 * Has this held release timed out?
 *
 * The engine sets expiresAt on anything needing a human, and an expired intent
 * cannot be approved into a deploy. Showing it as merely "waiting" invites
 * somebody to click approve and collect an error.
 */
export function isExpired(intent: ReleaseIntent, now: Date = new Date()): boolean {
  if (!intent.expiresAt || intent.status !== 'awaiting_approval') return false
  const t = Date.parse(intent.expiresAt)
  return Number.isFinite(t) && t <= now.getTime()
}
