import { describe, expect, it } from 'vitest'

import {
  approvalsGiven,
  approversRequired,
  groupIntents,
  holdReasons,
  isDecidable,
  isExpired,
  riskBand,
  shortSha,
  statusSummary,
  type ReleaseIntent,
} from './releases'

/**
 * The cases that matter are the ones where a wrong answer reads as success.
 *
 * A two-approver release that looks fully signed, and an approval whose build
 * never started, both end with somebody believing code shipped when it did not.
 */

const intent = (over: Partial<ReleaseIntent> = {}): ReleaseIntent => ({
  id: 'i1',
  ref: 'DI-1',
  siteId: 's1',
  status: 'awaiting_approval',
  commitSha: '261a0d6f4c38cef13531e5b90ee1cd068ae79352',
  policyEval: [{ rule: 'release.deploy_mode.manual', title: 'manual', verdict: 'needs_human' }],
  approvals: [],
  ...over,
})

describe('approversRequired', () => {
  it('wants two for a schema change and one otherwise', () => {
    // Transcribed from the engine. Requiring one where it requires two would
    // show "ready to release" on something still holding for a second person.
    expect(approversRequired(intent())).toBe(1)
    expect(
      approversRequired(
        intent({
          policyEval: [
            { rule: 'production.schema_change', title: 'schema', verdict: 'needs_human' },
            { rule: 'release.deploy_mode.manual', title: 'manual', verdict: 'needs_human' },
          ],
        })
      )
    ).toBe(2)
  })

  it('is zero when nothing needs a human', () => {
    expect(
      approversRequired(
        intent({ policyEval: [{ rule: 'production.autonomy_level', title: 'ok', verdict: 'satisfied' }] })
      )
    ).toBe(0)
  })
})

describe('statusSummary', () => {
  it('counts the signatures still outstanding on a two-approver release', () => {
    const i = intent({
      policyEval: [
        { rule: 'production.schema_change', title: 'schema', verdict: 'needs_human' },
        { rule: 'release.deploy_mode.manual', title: 'manual', verdict: 'needs_human' },
      ],
      approvals: [{ userId: 'u1', name: 'someone' }],
    })
    expect(approvalsGiven(i)).toBe(1)
    expect(statusSummary(i)).toContain('1 more of 2')
  })

  it('does not call a started build a release on its own', () => {
    // The container may still be rolling and the intent alone cannot say.
    expect(statusSummary(intent({ status: 'executing' }))).toBe('Build started')
    expect(statusSummary(intent({ status: 'succeeded' }))).toBe('Released')
  })

  it('believes the deployment over the intent once it has one', () => {
    // Observed live: nothing ever moves an intent past `executing`. Across
    // sixty real intents the statuses were awaiting_approval, executing,
    // declined, superseded and expired — no succeeded, ever. DI-4618 sat at
    // `executing` with its deployment already `ready`, so treating the intent
    // as the source of truth would show a finished release as permanently
    // stuck.
    expect(statusSummary(intent({ status: 'executing' }), { status: 'ready' })).toBe('Released')
    expect(statusSummary(intent({ status: 'executing' }), { status: 'error' })).toBe('Build failed')
  })

  it('handles the expired status the engine actually sets', () => {
    // Seven of sixty live intents were `expired`, a status missing from the
    // engine type I transcribed. Without this it fell through to printing the
    // raw word at the user.
    expect(statusSummary(intent({ status: 'expired' }))).toContain('Expired')
    // Also reachable while still nominally awaiting_approval, past the window.
    expect(
      statusSummary(intent({ status: 'awaiting_approval', expiresAt: '2000-01-01T00:00:00Z' }))
    ).toContain('Expired')
  })

  it('says plainly when the approval landed but the build did not start', () => {
    // The engine leaves an intent at `approved` when redeployFromGit fails.
    // Reporting that as shipped is the worst available answer: the grant is
    // spent, nothing is deploying, and nobody is told.
    expect(statusSummary(intent({ status: 'approved' }))).toContain('has not started')
  })

  it("passes the engine's own decline reason through", () => {
    const text = statusSummary(
      intent({ status: 'superseded', declineReason: 'Superseded by DI-4619 (261a0d6).' })
    )
    expect(text).toContain('DI-4619')
  })
})

describe('isDecidable', () => {
  it('is true only while the engine would accept a decision', () => {
    // Anything else 409s with "there is nothing to decide", so offering the
    // button is offering an error.
    expect(isDecidable(intent())).toBe(true)
    for (const status of ['approved', 'executing', 'succeeded', 'failed', 'declined', 'superseded']) {
      expect(isDecidable(intent({ status }))).toBe(false)
    }
  })
})

describe('holdReasons', () => {
  it('returns only the rules actually holding it', () => {
    const i = intent({
      policyEval: [
        { rule: 'production.autonomy_level', title: 'Autonomous', verdict: 'satisfied' },
        { rule: 'release.deploy_mode.manual', title: 'This app deploys manually', verdict: 'needs_human' },
      ],
    })
    expect(holdReasons(i)).toHaveLength(1)
    expect(holdReasons(i)[0].title).toBe('This app deploys manually')
  })
})

describe('groupIntents', () => {
  it('separates the to-do list from the record', () => {
    const { waiting, active, closed } = groupIntents([
      intent({ id: 'a', status: 'awaiting_approval' }),
      intent({ id: 'b', status: 'executing' }),
      intent({ id: 'c', status: 'superseded' }),
      intent({ id: 'd', status: 'declined' }),
    ])
    expect(waiting.map((i) => i.id)).toEqual(['a'])
    expect(active.map((i) => i.id)).toEqual(['b'])
    // Kept, not hidden: a decline is the answer to "why didn't my merge deploy?"
    expect(closed.map((i) => i.id)).toEqual(['c', 'd'])
  })
})

describe('isExpired', () => {
  const now = new Date('2026-09-17T20:00:00Z')

  it('flags a held release whose window has passed', () => {
    // Approving one of these fails. Showing it as merely waiting invites the
    // click that collects the error.
    expect(isExpired(intent({ expiresAt: '2026-09-17T19:31:48Z' }), now)).toBe(true)
    expect(isExpired(intent({ expiresAt: '2026-09-17T23:00:00Z' }), now)).toBe(false)
  })

  it('never calls a decided intent expired', () => {
    // Only a pending decision can time out; a superseded one already ended.
    expect(isExpired(intent({ status: 'superseded', expiresAt: '2026-09-17T19:31:48Z' }), now)).toBe(
      false
    )
  })
})

describe('riskBand and shortSha', () => {
  it('bands the engine 0..1 score', () => {
    expect(riskBand(0.15)).toBe('low')
    expect(riskBand(0.5)).toBe('medium')
    expect(riskBand(0.9)).toBe('high')
    expect(riskBand(null)).toBe('low')
  })

  it('shortens a full sha without breaking on an empty one', () => {
    expect(shortSha('261a0d6f4c38cef13531e5b90ee1cd068ae79352')).toBe('261a0d6')
    expect(shortSha(null)).toBe('')
  })
})
