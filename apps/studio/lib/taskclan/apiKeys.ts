/**
 * Cloud API keys: how a list of them reads, and what to tell someone before
 * they revoke one.
 *
 * These are `sk_cloud_*` keys for the Taskclan Cloud API. Two things about them
 * shape everything here:
 *
 * 1. **The plaintext exists exactly once.** The engine stores only a SHA-256
 *    hash and a 14-character prefix, so a key that is not copied at creation is
 *    gone. The UI has to be emphatic about that rather than tasteful.
 * 2. **Revoking takes effect immediately and cannot be undone.** Whatever was
 *    using the key stops working at once, which is why `revokeWarning` leads
 *    with when the key was last used: a key used minutes ago is load-bearing
 *    right now, and a key never used is almost certainly safe to remove.
 *
 * Pure so it can be tested without a network or a clock.
 */
import dayjs from 'dayjs'

export interface CloudApiKey {
  id: string
  name: string | null
  keyPrefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

/** What a key is called when nobody named it. */
export function keyLabel(key: Pick<CloudApiKey, 'name' | 'keyPrefix'>): string {
  const named = (key.name ?? '').trim()
  return named.length > 0 ? named : key.keyPrefix
}

/**
 * Active keys first, revoked kept separately rather than discarded.
 *
 * The engine's own console filters revoked keys out of the list entirely. That
 * loses a question people actually ask — "did I already revoke the one that
 * leaked?" — and the answer is in the data, so it is kept.
 */
export function partitionKeys(keys: CloudApiKey[]): {
  active: CloudApiKey[]
  revoked: CloudApiKey[]
} {
  return {
    active: keys.filter((k) => !k.revokedAt),
    revoked: keys.filter((k) => !!k.revokedAt),
  }
}

/**
 * "never used" reads better than an em dash here, because for a key it is a
 * meaningful state rather than missing data: it tells you removing it is safe.
 */
export function describeLastUsed(iso: string | null, now: dayjs.ConfigType = undefined): string {
  if (!iso) return 'Never used'
  const d = dayjs(iso)
  if (!d.isValid()) return 'Never used'
  return `Last used ${d.from(dayjs(now))}`
}

export type RevokeRisk = 'never' | 'idle' | 'stale' | 'live'

/**
 * What revoking this key is likely to break, judged by recency of use.
 *
 * The thresholds are coarse on purpose. The point is not to be precise about
 * when a key stopped mattering, it is to stop somebody revoking a key that is
 * serving CI right now because the row looked untidy.
 */
export function revokeRisk(
  key: Pick<CloudApiKey, 'lastUsedAt'>,
  now: dayjs.ConfigType = undefined
): RevokeRisk {
  // 'never' is kept distinct from 'idle' deliberately. Collapsing them lets the
  // warning tell somebody a key has never been used when it was in fact used
  // two months ago, which is a fabricated reassurance about a destructive
  // action — the worst place to have one.
  if (!key.lastUsedAt) return 'never'
  const used = dayjs(key.lastUsedAt)
  if (!used.isValid()) return 'never'
  const hours = dayjs(now).diff(used, 'hour', true)
  if (hours <= 24) return 'live'
  if (hours <= 24 * 30) return 'stale'
  return 'idle'
}

/**
 * Does this key look like one `taskclan login` minted for a machine?
 *
 * The CLI's device flow calls the same key endpoint with `{ label: os.hostname() }`,
 * so these arrive named "taskclan CLI (some-host)" and sit in the list looking
 * exactly like a key somebody made by hand. Revoking one logs that machine out
 * of `git push`, which is worth saying before rather than after.
 *
 * Matched on the name because that is the only signal the engine records; a key
 * renamed by hand stops matching, which fails quiet rather than wrong.
 */
export function isCliKey(key: Pick<CloudApiKey, 'name'>): boolean {
  return /^taskclan cli\b/i.test((key.name ?? '').trim())
}

/** The sentence under "Revoke this key?". */
export function revokeWarning(
  key: Pick<CloudApiKey, 'lastUsedAt' | 'name' | 'keyPrefix'>,
  now: dayjs.ConfigType = undefined
): string {
  const risk = revokeRisk(key, now)
  // A CLI key is not an abstract credential to its owner: it is the reason
  // `git push` works on a particular machine. Name the consequence.
  const consequence = isCliKey(key)
    ? 'That machine is signed out of the Taskclan CLI and `git push` stops working there until you run `taskclan login` again.'
    : 'Anything authenticating with it stops working immediately.'

  if (risk === 'never') {
    return `This key has never been used. ${consequence}`
  }
  const when = dayjs(key.lastUsedAt!).from(dayjs(now))
  if (risk === 'live') {
    return `This key was used ${when}, so something is using it right now. ${consequence}`
  }
  return `This key was last used ${when}. ${consequence}`
}
