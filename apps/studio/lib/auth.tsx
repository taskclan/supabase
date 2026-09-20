import { useQueryClient } from '@tanstack/react-query'
import {
  AuthProvider as AuthProviderInternal,
  clearLocalStorage,
  gotrueClient,
  posthogClient,
  useAuthError,
} from 'common'
import { PropsWithChildren, useCallback, useEffect } from 'react'
import { toast } from 'sonner'

import { GOTRUE_ERRORS, IS_PLATFORM } from './constants'
import { cloudSignupEnabledClient } from './taskclan/signupFlag'
import { useAiAssistantStateSnapshot } from '@/state/ai-assistant-state'

/**
 * Keep the server-side Cloud session cookie in step with the GoTrue session.
 *
 * When self-serve signup is on, every server call scopes to the user's org via
 * an httpOnly cookie holding their per-org key. This establishes/refreshes it
 * whenever the user signs in (or the token refreshes) and clears it on sign-out
 * — the one place that turns a GoTrue login into a scoped Cloud session. No-op
 * unless the flag is on, so single-tenant behavior is untouched.
 */
const CloudSessionSync = ({ children }: PropsWithChildren) => {
  useEffect(() => {
    if (!cloudSignupEnabledClient()) return

    const establish = async (accessToken: string) => {
      try {
        await fetch('/api/taskclan/session', {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}` },
        })
      } catch {
        // Best-effort: until it lands the Cloud client fails closed, never leaks.
      }
    }
    const clear = async () => {
      try {
        await fetch('/api/taskclan/session', { method: 'DELETE' })
      } catch {
        /* best-effort */
      }
    }

    void gotrueClient.getSession().then(({ data }) => {
      if (data.session?.access_token) void establish(data.session.access_token)
    })
    const { data } = gotrueClient.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') void clear()
      else if (session?.access_token) void establish(session.access_token)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return children
}

const AuthErrorToaster = ({ children }: PropsWithChildren) => {
  const error = useAuthError()

  useEffect(() => {
    if (error !== null) {
      // Check for unverified GitHub users after a GitHub sign in
      if (error.message === GOTRUE_ERRORS.UNVERIFIED_GITHUB_USER) {
        toast.error(
          'Please verify your email on GitHub first, then reach out to us at support@supabase.io to log into the dashboard'
        )
        return
      }

      toast.error(error.message)
    }
  }, [error])

  return children
}

export const AuthProvider = ({ children }: PropsWithChildren) => {
  // `alwaysLoggedIn` is what made the console single-tenant: with no real auth,
  // the provider hands every visitor a session and the app runs as one org.
  // When self-serve signup is on we turn that off, so the provider requires a
  // real GoTrue session (and gates unauthenticated visitors to sign-in itself).
  // Flag off ⇒ exactly the previous value, so nothing changes until go-live.
  const alwaysLoggedIn = !IS_PLATFORM && !cloudSignupEnabledClient()
  return (
    <AuthProviderInternal alwaysLoggedIn={alwaysLoggedIn}>
      <CloudSessionSync>
        <AuthErrorToaster>{children}</AuthErrorToaster>
      </CloudSessionSync>
    </AuthProviderInternal>
  )
}

export function useSignOut() {
  const queryClient = useQueryClient()
  const { clearStorage: clearAssistantStorage } = useAiAssistantStateSnapshot()

  return useCallback(async () => {
    const result = await gotrueClient.signOut()
    if (cloudSignupEnabledClient()) {
      // Drop the server-side Cloud session too, or the next request would still
      // carry the signed-out user's org key.
      try {
        await fetch('/api/taskclan/session', { method: 'DELETE' })
      } catch {
        /* best-effort */
      }
    }
    posthogClient.reset()
    clearLocalStorage()
    // Clear Assistant IndexedDB
    await clearAssistantStorage()
    queryClient.clear()

    return result
  }, [queryClient, clearAssistantStorage])
}
