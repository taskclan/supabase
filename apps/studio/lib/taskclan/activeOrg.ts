/**
 * Which organisation the browser is acting in.
 *
 * Cloud scopes a request by the `x-taskclan-org` header, and a person can
 * belong to several organisations, so something has to remember which one is
 * selected. Studio already navigates between them by URL (`/org/{slug}`), which
 * is the better source of truth because it is shareable and survives a reload;
 * this store just carries the resolved uuid to the fetch layer, where the URL is
 * not in reach.
 *
 * The value may be either the org's uuid or its slug: the engine resolves
 * `x-taskclan-org` with `org.id === requested || org.slug === requested`. The
 * browser stores the slug, because that is what Studio already has in the URL
 * and it needs no extra plumbing to discover; server-side callers pass the uuid
 * because that is what they have resolved.
 *
 * The localStorage key is deliberately `taskclan-org`, the same one the engine's
 * own console uses, so somebody moving between the two consoles keeps their
 * active organisation rather than silently landing in a different one.
 *
 * Reads and writes are wrapped because localStorage throws outright in Safari
 * under some privacy settings, and an unavailable store should cost the header,
 * not the page.
 */
const STORAGE_KEY = 'taskclan-org'

let current: string | null = null

function readStored(): string | null {
  try {
    return globalThis?.localStorage?.getItem(STORAGE_KEY) || null
  } catch {
    return null
  }
}

/** The active org uuid, or null when none has been selected yet. */
export function activeOrg(): string | null {
  if (current) return current
  current = readStored()
  return current
}

/** Remember the active org. Passing null forgets it, which is what signing out wants. */
export function setActiveOrg(org: string | null): void {
  current = org
  try {
    if (org) globalThis?.localStorage?.setItem(STORAGE_KEY, org)
    else globalThis?.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Kept in memory for this tab, which is better than failing the navigation
    // that triggered it.
  }
}

/** Tests only. */
export function resetActiveOrg(): void {
  current = null
}
