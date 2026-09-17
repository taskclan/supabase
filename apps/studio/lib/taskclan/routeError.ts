/**
 * What a failed project-detail request actually means.
 *
 * Upstream collapsed this into "404 or else", and told the user "you do not
 * have access to this project" for everything that was not a 404 — then
 * redirected them to the home page. On Supabase's own hosting that is a fair
 * simplification: the control plane is up, or the whole dashboard is down.
 *
 * With Taskclan Cloud behind it, the same code turns a transient 502 into
 * "you were removed from this app", and the redirect hides the cause because
 * the home page fails identically. Daniel hit exactly this on 2026-09-12 when
 * the backend was briefly unreachable.
 *
 * Split out as a pure function because the alternative — proving it through the
 * UI — means waiting on React Query's retry schedule to exhaust, which took
 * over thirty seconds and still had not settled.
 */

export type ProjectErrorKind =
  /** The backend could not be reached, or failed. Not about permissions. */
  | 'unreachable'
  /** The app is gone — deleted, or never existed. */
  | 'gone'
  /** The caller genuinely may not see this app. */
  | 'no_access'

/**
 * `code` is ResponseError.code — the HTTP status, or undefined when the
 * request never got a response at all (DNS, connection refused, timeout).
 *
 * undefined is treated as unreachable rather than as denied, which is the
 * whole point: a request that never arrived cannot have been refused.
 */
export function classifyProjectError(code: number | undefined): ProjectErrorKind {
  if (code === undefined) return 'unreachable'
  if (code >= 500) return 'unreachable'
  if (code === 404) return 'gone'
  if (code === 401 || code === 403) return 'no_access'
  // Any other 4xx is a bad request rather than a refusal, and saying "no
  // access" would send someone to ask for a permission they already have.
  return 'unreachable'
}

/** Whether to leave the user where they are. */
export function shouldStay(kind: ProjectErrorKind): boolean {
  // Redirecting on an unreachable backend hides the cause: the home page
  // needs the same backend and fails the same way, so the user lands
  // somewhere equally broken with a message about permissions. Staying put
  // means a reload recovers in place once the backend is back.
  return kind === 'unreachable'
}

export function messageFor(kind: ProjectErrorKind): string | null {
  switch (kind) {
    case 'unreachable':
      return 'Could not reach Taskclan Cloud. This is not a permissions problem, so retry in a moment.'
    case 'no_access':
      return 'You do not have access to this project'
    case 'gone':
      // Silent on purpose, as upstream is: the redirect to the app list is
      // self-explanatory for something that no longer exists.
      return null
  }
}
