/**
 * Installing the Taskclan Cloud GitHub App, and getting back.
 *
 * The install leaves the console. Cloud signs an install URL (only it can: the
 * state names the workspace the installation is for), GitHub shows its own
 * screens, and Cloud's callback sends the browser back with `?git=<outcome>`.
 * Two things decide whether that ends on the page it began on:
 *
 *   - Cloud reads the way back as two halves, `origin` and `returnPath`, and
 *     checks each against its own allowlist. It never read the `returnTo` this
 *     console used to send, so every install finished on the engine's old
 *     console instead.
 *   - The page it comes back to has to say what happened, because the outcome
 *     is not always "connected".
 *
 * Only a first install comes back. GitHub sends a change to an existing
 * installation's repository access to its own settings page, without calling
 * Cloud at all.
 */

/** The query parameter Cloud's callback carries the outcome in. */
export const OUTCOME_PARAM = 'git'

/** Cloud refuses a longer return path and sends the person somewhere else. */
const MAX_RETURN_PATH = 200

export interface ReturnTarget {
  /** The console's own origin; Cloud only returns to `https://*.taskclan.com`. */
  origin: string
  /** The page, with its query, minus any outcome an earlier attempt left there. */
  returnPath: string
}

/** The two halves Cloud's connect route reads, from the URL of the page the install starts on. */
export function returnTarget(returnTo: unknown): ReturnTarget | null {
  if (typeof returnTo !== 'string' || !returnTo) return null
  let url: URL
  try {
    url = new URL(returnTo)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  // An outcome left by an earlier attempt would come back next to the new one.
  if (url.searchParams.has(OUTCOME_PARAM)) url.searchParams.delete(OUTCOME_PARAM)

  // Cloud refuses a path that is too long or carries a colon or a backslash,
  // and falls back to a page of its own that this console does not have.
  // Without its query, the page is still the one the person left.
  const path = `${url.pathname}${url.search}`
  const returnPath = path.length <= MAX_RETURN_PATH && !/[:\\]/.test(path) ? path : url.pathname
  return { origin: url.origin, returnPath }
}

export type GitHubOutcome = 'connected' | 'installed' | 'unattributed' | 'error'

interface OutcomeNotice {
  tone: 'success' | 'warning' | 'error'
  title: string
  description?: string
}

/**
 * What each outcome tells the person. Cloud's own console says the same things,
 * except where its advice is the advice that does not work: re-running the
 * install against an account that already has the app never reaches Cloud's
 * callback (TAS-653), so a stray installation is fixed by uninstalling it first.
 */
export const GITHUB_OUTCOMES: Record<GitHubOutcome, OutcomeNotice> = {
  // Not a promise that repositories are listed: granting none is a normal
  // outcome of GitHub's install screen, and the page knows which case it is.
  connected: { tone: 'success', title: 'GitHub connected' },
  // Installed from GitHub's own page, which carries no workspace to record.
  installed: {
    tone: 'warning',
    title: 'The GitHub App was installed, but not for this workspace',
    description:
      'Uninstall it on GitHub, then connect again from here: only a fresh install carries the workspace with it.',
  },
  // We lost the workspace on the way back. Saying so keeps anyone from
  // re-running the install as though they had done something wrong.
  unattributed: {
    tone: 'warning',
    title: 'The GitHub App was installed, but we lost track of which workspace it was for',
    description:
      'Nothing is wrong on GitHub. Uninstall it there, then connect again from here to attach it.',
  },
  error: {
    tone: 'error',
    title: 'GitHub sent you back without an installation',
    description: 'Nothing was connected. Try again.',
  },
}

const OUTCOMES = Object.keys(GITHUB_OUTCOMES) as GitHubOutcome[]

/** The outcome a `?git=` value names, or null for anything else. */
export function githubOutcome(value: unknown): GitHubOutcome | null {
  return OUTCOMES.find((outcome) => outcome === value) ?? null
}
