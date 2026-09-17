import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { describe, expect, it } from 'vitest'

import {
  describeLastUsed,
  isCliKey,
  keyLabel,
  partitionKeys,
  revokeRisk,
  revokeWarning,
  type CloudApiKey,
} from './apiKeys'

// The app extends dayjs at its entry points; a unit test has no entry point.
dayjs.extend(relativeTime)

const NOW = '2026-09-17T12:00:00.000Z'

const key = (over: Partial<CloudApiKey> = {}): CloudApiKey => ({
  id: 'k1',
  name: 'CI',
  keyPrefix: 'sk_cloud_ab12c',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

describe('keyLabel', () => {
  it('falls back to the prefix when nobody named the key', () => {
    // The prefix is the only other thing that identifies it, and it is what the
    // engine logs, so it is what someone would match against.
    expect(keyLabel(key({ name: null }))).toBe('sk_cloud_ab12c')
    expect(keyLabel(key({ name: '   ' }))).toBe('sk_cloud_ab12c')
  })
})

describe('partitionKeys', () => {
  it('keeps revoked keys instead of discarding them', () => {
    // The engine's console filters them out. That loses the answer to "did I
    // already revoke the one that leaked?", which is a question people ask at
    // exactly the moment it matters.
    const { active, revoked } = partitionKeys([
      key({ id: 'a' }),
      key({ id: 'b', revokedAt: '2026-09-10T00:00:00.000Z' }),
    ])
    expect(active.map((k) => k.id)).toEqual(['a'])
    expect(revoked.map((k) => k.id)).toEqual(['b'])
  })
})

describe('describeLastUsed', () => {
  it('says never used rather than showing a dash', () => {
    // For a key this is a real state, not missing data: it means removing it is
    // safe. A dash would read as "we do not know".
    expect(describeLastUsed(null, NOW)).toBe('Never used')
  })

  it('reads as elapsed time, which is what the decision turns on', () => {
    expect(describeLastUsed('2026-09-17T10:00:00.000Z', NOW)).toBe('Last used 2 hours ago')
  })
})

describe('revokeRisk', () => {
  it('separates never-used from long-idle', () => {
    // These are different facts and only one of them is a reassurance. Merging
    // them is the bug this test exists for.
    expect(revokeRisk({ lastUsedAt: null }, NOW)).toBe('never')
    expect(revokeRisk({ lastUsedAt: '2026-06-01T12:00:00.000Z' }, NOW)).toBe('idle')
  })

  it('treats the last day as live and the last month as stale', () => {
    expect(revokeRisk({ lastUsedAt: '2026-09-17T11:00:00.000Z' }, NOW)).toBe('live')
    expect(revokeRisk({ lastUsedAt: '2026-09-10T12:00:00.000Z' }, NOW)).toBe('stale')
  })

  it('does not treat an unparseable timestamp as recent use', () => {
    // Guessing 'live' from junk would nag on every revoke; guessing a date
    // would be worse. Unknown falls back to the honest "no usage recorded".
    expect(revokeRisk({ lastUsedAt: 'not-a-date' }, NOW)).toBe('never')
  })
})

describe('revokeWarning', () => {
  it('does not claim a long-idle key was never used', () => {
    // The regression this file was written for. `revokeRisk` returns 'idle' for
    // both "never" and "two months ago", so a warning keyed only on that value
    // tells someone a key has never been used when it has. That is a fabricated
    // reassurance attached to an irreversible action.
    const warning = revokeWarning({ ...key({ lastUsedAt: '2026-06-01T12:00:00.000Z' }) }, NOW)
    expect(warning).not.toContain('never been used')
    expect(warning).toContain('4 months ago')
  })

  it('says something is using it now when the key is live', () => {
    const warning = revokeWarning({ ...key({ lastUsedAt: '2026-09-17T11:00:00.000Z' }) }, NOW)
    expect(warning).toContain('using it right now')
  })

  it('reassures only when the key really has never been used', () => {
    expect(revokeWarning({ ...key({ lastUsedAt: null }) }, NOW)).toContain('never been used')
  })

  it('always states that revoking takes effect immediately', () => {
    // Whatever the recency, the irreversible part has to be on screen.
    for (const lastUsedAt of [null, '2026-09-17T11:00:00.000Z', '2026-06-01T12:00:00.000Z']) {
      expect(revokeWarning({ ...key({ lastUsedAt }) }, NOW)).toContain('immediately')
    }
  })
})

describe('CLI login keys', () => {
  it('recognises the keys `taskclan login` mints', () => {
    // The device flow posts `{ label: os.hostname() }` to the same endpoint, so
    // these land in the list looking hand-made.
    expect(isCliKey({ name: 'taskclan CLI (danielamah@Daniels-MacBook-Pro.local)' })).toBe(true)
    expect(isCliKey({ name: 'taskclan cli (other-host)' })).toBe(true)
  })

  it('does not claim an unrelated key is a CLI login', () => {
    // False positives here would tell someone revoking their CI key that it
    // signs a machine out of git push, which is its own kind of wrong.
    expect(isCliKey({ name: 'CI' })).toBe(false)
    expect(isCliKey({ name: null })).toBe(false)
    expect(isCliKey({ name: 'taskclan-cloud-api-key' })).toBe(false)
  })

  it('tells the owner what revoking actually costs them', () => {
    // The correction this exists for: these really are the CLI's credentials,
    // so "anything authenticating with it stops working" understates it. The
    // consequence someone cares about is that `git push` breaks on that laptop.
    const warning = revokeWarning(
      { name: 'taskclan CLI (my-laptop)', keyPrefix: 'sk_cloud_x', lastUsedAt: null },
      NOW
    )
    expect(warning).toContain('taskclan login')
    expect(warning).toContain('git push')
  })

  it('leaves a non-CLI key with the generic consequence', () => {
    const warning = revokeWarning(
      { name: 'CI', keyPrefix: 'sk_cloud_x', lastUsedAt: null },
      NOW
    )
    expect(warning).not.toContain('git push')
    expect(warning).toContain('stops working immediately')
  })
})
