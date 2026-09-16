import { AuthClient, navigatorLock, User } from '@supabase/auth-js'
import { isBrowser } from './helpers'

/**
 * Taskclan Cloud's own auth project.
 *
 * When both are set this client points at Taskclan's Supabase rather than
 * upstream's GoTrue, which is how the console gets per-user sessions without
 * turning on `IS_PLATFORM` (283 files deep, and it would un-hide the billing
 * and marketplace screens this fork suppresses).
 *
 * Inert when unset, so every other app in the monorepo is unaffected and the
 * console itself behaves exactly as before until the values are configured.
 */
const TASKCLAN_AUTH_URL = process.env.NEXT_PUBLIC_TASKCLAN_AUTH_URL?.replace(/\/+$/, '')
const TASKCLAN_AUTH_ANON_KEY = process.env.NEXT_PUBLIC_TASKCLAN_AUTH_ANON_KEY
const taskclanAuthEnabled = !!TASKCLAN_AUTH_URL && !!TASKCLAN_AUTH_ANON_KEY

export const STORAGE_KEY = process.env.NEXT_PUBLIC_STORAGE_KEY || 'supabase.dashboard.auth.token'
export const AUTH_DEBUG_KEY =
  process.env.NEXT_PUBLIC_AUTH_DEBUG_KEY || 'supabase.dashboard.auth.debug'
export const AUTH_DEBUG_PERSISTED_KEY =
  process.env.NEXT_PUBLIC_AUTH_DEBUG_PERSISTED_KEY || 'supabase.dashboard.auth.debug.persist'
export const AUTH_NAVIGATOR_LOCK_DISABLED_KEY =
  process.env.NEXT_PUBLIC_AUTH_NAVIGATOR_LOCK_KEY ||
  'supabase.dashboard.auth.navigatorLock.disabled'

/**
 * Catches errors thrown when accessing localStorage. Safari with certain
 * security settings throws when localStorage is accessed.
 */
function safeGetLocalStorage(key: string) {
  try {
    return globalThis?.localStorage?.getItem(key)
  } catch {
    return null
  }
}

const authEnabled = process.env.NEXT_PUBLIC_IS_PLATFORM === 'true' || taskclanAuthEnabled

const debug = authEnabled && safeGetLocalStorage(AUTH_DEBUG_KEY) === 'true'

const persistedDebug = authEnabled && safeGetLocalStorage(AUTH_DEBUG_PERSISTED_KEY) === 'true'

// Not optional once sessions are real: without the lock two tabs can race a
// token refresh, and the loser is left holding a refresh token that has already
// been rotated away, which signs that tab out for no visible reason.
const shouldEnableNavigatorLock =
  authEnabled && !(safeGetLocalStorage(AUTH_NAVIGATOR_LOCK_DISABLED_KEY) === 'true')

const shouldDetectSessionInUrl = process.env.NEXT_PUBLIC_AUTH_DETECT_SESSION_IN_URL
  ? process.env.NEXT_PUBLIC_AUTH_DETECT_SESSION_IN_URL === 'true'
  : true

const navigatorLockEnabled = !!(shouldEnableNavigatorLock && globalThis?.navigator?.locks)

if (isBrowser && shouldEnableNavigatorLock && !globalThis?.navigator?.locks) {
  console.warn('This browser does not support the Navigator Locks API. Please update it.')
}

const tabId = Math.random().toString(16).substring(2)

let dbHandle = new Promise<IDBDatabase | null>((accept, _) => {
  if (!persistedDebug) {
    accept(null)
    return
  }

  const request = indexedDB.open('auth-debug-log', 1)

  request.onupgradeneeded = (event: any) => {
    const db = event?.target?.result

    if (!db) {
      return
    }

    db.createObjectStore('events', { autoIncrement: true })
  }

  request.onsuccess = (event: any) => {
    console.log('Opened persisted auth debug log IndexedDB database', tabId)
    accept(event.target.result)
  }

  request.onerror = (event: any) => {
    console.error('Failed to open persisted auth debug log IndexedDB database', event)
    accept(null)
  }
})

const logIndexedDB = (message: string, ...args: any[]) => {
  console.log(message, ...args)

  const copyArgs = structuredClone(args)

  copyArgs.forEach((value) => {
    if (typeof value === 'object' && value !== null) {
      delete value.user
      delete value.access_token
      delete value.token_type
      delete value.provider_token
    }
  })
  ;(async () => {
    try {
      const db = await dbHandle

      if (!db) {
        return
      }

      const tx = db.transaction(['events'], 'readwrite')
      tx.onerror = (event: any) => {
        console.error('Failed to write to persisted auth debug log IndexedDB database', event)
        dbHandle = Promise.resolve(null)
      }

      const events = tx.objectStore('events')

      events.add({
        m: message.replace(/^GoTrueClient@/i, ''),
        a: copyArgs,
        l: window.location.pathname,
        t: tabId,
      })
    } catch (e: any) {
      console.error('Failed to log to persisted auth debug log IndexedDB database', e)
      dbHandle = Promise.resolve(null)
    }
  })()
}

/**
 * Reference to a function that captures exceptions for debugging purposes to be sent to Sentry.
 */
let captureException: ((e: any) => any) | null = null

export function setCaptureException(fn: typeof captureException) {
  captureException = fn
}

async function debuggableNavigatorLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> {
  let stackException: any

  try {
    throw new Error('Lock is being held for over 10s here')
  } catch (e: any) {
    stackException = e
  }

  const debugTimeout = setTimeout(() => {
    ;(async () => {
      const bc = new BroadcastChannel('who-is-holding-the-lock')
      try {
        bc.postMessage({})
      } finally {
        bc.close()
      }

      console.error(
        `Waited for over 10s to acquire an Auth client lock`,
        await navigator.locks.query(),
        stackException
      )
    })()
  }, 10000)

  try {
    return await navigatorLock(name, acquireTimeout, async () => {
      clearTimeout(debugTimeout)

      const bc = new BroadcastChannel('who-is-holding-the-lock')
      bc.addEventListener('message', () => {
        console.error('Lock is held here', stackException)

        if (captureException) {
          captureException(stackException)
        }
      })

      try {
        return await fn()
      } finally {
        bc.close()
      }
    })
  } finally {
    clearTimeout(debugTimeout)
  }
}

export const gotrueClient = new AuthClient({
  url: taskclanAuthEnabled ? `${TASKCLAN_AUTH_URL}/auth/v1` : process.env.NEXT_PUBLIC_GOTRUE_URL,
  // Mandatory against hosted Supabase: /auth/v1/* answers 401 without an
  // `apikey`, which is why the engine sets it explicitly on its own calls.
  ...(taskclanAuthEnabled ? { headers: { apikey: TASKCLAN_AUTH_ANON_KEY as string } } : null),
  storageKey: STORAGE_KEY,
  detectSessionInUrl: shouldDetectSessionInUrl,
  debug: debug ? (persistedDebug ? logIndexedDB : true) : false,
  lock: navigatorLockEnabled ? debuggableNavigatorLock : undefined,
  ...('localStorage' in globalThis
    ? { storage: globalThis.localStorage, userStorage: globalThis.localStorage }
    : null),
})

export type { User }
