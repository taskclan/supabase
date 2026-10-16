/**
 * Nobody sees the console without being signed in.
 *
 * Upstream's answer is `withAuth`, and it is the wrong seam here for three
 * reasons. It is opt-in, so a page added later defaults to ungated, and for a
 * console serving external customers the tenancy boundary should not be
 * something you can forget to apply. It sits below `ProfileProvider` and
 * `RouteValidationWrapper`, so a signed-out visitor to /project/foo still fires
 * a project-detail request and collects a toast before being redirected. And it
 * signs the user out before redirecting, which means a transient loading state
 * costs a session.
 *
 * So the gate goes above all of that, in one place, and `withAuth` is left
 * alone: it is heavily maintained upstream and this fork has to stay rebaseable.
 *
 * Inert until auth is configured, like everything else in this migration.
 */
import { useIsLoggedIn, useIsUserLoading } from 'common'
import { useRouter } from 'next/router'
import { useEffect, type PropsWithChildren } from 'react'

import { TASKCLAN_AUTH_ENABLED } from '@/lib/constants'

/**
 * Routes that render to a signed-out visitor.
 *
 * Matched on `router.pathname`, the route pattern rather than the URL, so a
 * dynamic segment cannot smuggle a path past it.
 *
 * Deliberately short. Upstream ships /sign-up, /forgot-password, /authorize,
 * /join, /cli/login and the partner flows, none of which this console runs;
 * leaving them out means they stop rendering to anonymous visitors, which is an
 * improvement rather than a regression.
 */
// /logout is public for a reason that is not obvious. Signing out clears the
// session while the page is still mounted, so the gate would see !isLoggedIn,
// redirect to /sign-in?returnTo=%2Flogout, and the next successful login would
// land back on /logout and sign the user straight out again. Visiting it
// without a session is harmless: it signs out nothing and moves on.
const PUBLIC_ROUTES = new Set([
  '/landing',
  '/sign-in',
  '/logout',
  '/404',
  '/500',
  '/_error',
  '/maintenance',
])

export const TaskclanAuthGate = ({ children }: PropsWithChildren) => {
  const router = useRouter()
  const isLoading = useIsUserLoading()
  const isLoggedIn = useIsLoggedIn()

  const isPublic = PUBLIC_ROUTES.has(router.pathname)
  const shouldRedirect = TASKCLAN_AUTH_ENABLED && !isLoading && !isLoggedIn && !isPublic

  useEffect(() => {
    if (!shouldRedirect) return
    // asPath, not pathname: coming back to /project/x/editor should return to
    // that app, not to the route pattern.
    router.replace(`/sign-in?returnTo=${encodeURIComponent(router.asPath)}`)
  }, [shouldRedirect, router])

  if (!TASKCLAN_AUTH_ENABLED) return <>{children}</>
  if (isPublic) return <>{children}</>

  // Redirecting during the loading window is the flash-of-sign-in bug: the
  // session is read asynchronously, so "not logged in yet" and "not logged in"
  // are indistinguishable for the first moment of every page load. Waiting
  // costs a beat; getting it wrong bounces people who are signed in.
  if (isLoading) return null
  if (!isLoggedIn) return null

  return <>{children}</>
}
