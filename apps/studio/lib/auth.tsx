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

import { GOTRUE_ERRORS, IS_PLATFORM, TASKCLAN_AUTH_ENABLED } from './constants'
import { useAiAssistantStateSnapshot } from '@/state/ai-assistant-state'

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

/**
 * `alwaysLoggedIn` is upstream's way of saying "self-hosted has no users, so
 * treat everyone as signed in". That stops being true the moment this console
 * does have users: left on, `useIsLoggedIn()` returns true for a signed-out
 * visitor, and the organization, profile and permission queries all fire
 * unauthenticated on first paint.
 */
export const AuthProvider = ({ children }: PropsWithChildren) => {
  return (
    <AuthProviderInternal alwaysLoggedIn={!IS_PLATFORM && !TASKCLAN_AUTH_ENABLED}>
      <AuthErrorToaster>{children}</AuthErrorToaster>
    </AuthProviderInternal>
  )
}

export function useSignOut() {
  const queryClient = useQueryClient()
  const { clearStorage: clearAssistantStorage } = useAiAssistantStateSnapshot()

  return useCallback(async () => {
    const result = await gotrueClient.signOut()
    posthogClient.reset()
    clearLocalStorage()
    // Clear Assistant IndexedDB
    await clearAssistantStorage()
    queryClient.clear()

    return result
  }, [queryClient, clearAssistantStorage])
}
