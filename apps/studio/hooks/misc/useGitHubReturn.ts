/**
 * Say how the GitHub App install went, on the page it came back to.
 *
 * Cloud's callback returns the person to the page they started on, with
 * `?git=<outcome>`. This reads it once the router has the query, tells them,
 * and takes it out of the URL, so a reload does not announce an install that
 * happened ten minutes ago.
 *
 * `onReturn` is for a page that has more to do than announce it, like the
 * new-app form going back to the repository picker the person left for GitHub.
 */
import { useRouter } from 'next/router'
import { useEffect, useEffectEvent } from 'react'
import { toast } from 'sonner'

import {
  GITHUB_OUTCOMES,
  githubOutcome,
  OUTCOME_PARAM,
  type GitHubOutcome,
} from '@/lib/taskclan/githubReturn'

export function useGitHubReturn(onReturn?: (outcome: GitHubOutcome) => void): void {
  const router = useRouter()
  const outcome = router.isReady ? githubOutcome(router.query[OUTCOME_PARAM]) : null

  const announce = useEffectEvent((outcome: GitHubOutcome) => {
    const { tone, title, description } = GITHUB_OUTCOMES[outcome]
    // One id, so a second run (strict mode runs effects twice in development)
    // replaces the toast rather than stacking another.
    toast[tone](title, { id: 'github-return', description })
    onReturn?.(outcome)
    const { [OUTCOME_PARAM]: _outcome, ...query } = router.query
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true })
  })

  useEffect(() => {
    if (outcome) announce(outcome)
  }, [outcome])
}
