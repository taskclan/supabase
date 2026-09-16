/**
 * Browser fetch for the console's own `/api/taskclan/*` routes.
 *
 * Those routes used to need nothing from the caller: they held a single shared
 * Cloud key and every visitor got the same org. With per-user auth the request
 * has to say who is making it, and which of that person's organisations it is
 * for, so both now travel as headers and one helper adds them.
 *
 * A helper rather than nineteen call sites partly for the obvious reason and
 * partly for a subtler one: the token has to be read fresh on every request.
 * Caching it in React state, which is what the engine's console does, leaves a
 * window between expiry and the refresh event where requests carry a stale
 * token. `getAccessToken()` reads through `getSession()`, which refreshes when
 * it is inside the margin, so every call gets a live one.
 *
 * A plain pass-through until auth is configured, so call sites could be
 * converted well before there was anything to send.
 */
import { getAccessToken } from 'common'

import { activeOrg } from './activeOrg'
import { TASKCLAN_AUTH_ENABLED } from '@/lib/constants'

export async function taskclanFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!TASKCLAN_AUTH_ENABLED) return fetch(path, init)

  const headers = new Headers(init.headers)

  // A failure to read the session must not take the request down with it: the
  // route still answers through the shared key while the fallback is on, and
  // once it is off the honest outcome is the route's 401 rather than an
  // exception thrown inside a component's effect.
  try {
    const token = await getAccessToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
  } catch {
    // Deliberately quiet: signed out is not an error worth logging on a screen
    // that is about to redirect to sign-in anyway.
  }

  const org = activeOrg()
  if (org) headers.set('x-taskclan-org', org)

  return fetch(path, { ...init, headers })
}
