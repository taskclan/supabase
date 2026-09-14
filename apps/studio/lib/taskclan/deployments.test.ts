import { describe, expect, it } from 'vitest'

import {
  commitSummary,
  currentDeployment,
  deployAction,
  deployState,
  formatAgo,
  formatDuration,
  hasDeployInFlight,
  type CloudDeployment,
} from './deployments'

const at = (over: Partial<CloudDeployment> = {}): CloudDeployment => ({
  id: 'd1',
  siteId: 's1',
  status: 'ready',
  createdAt: '2026-09-13T18:05:20.826566+00:00',
  ...over,
})

describe('deployState', () => {
  it('collapses the engine vocabulary to what a person acts on', () => {
    expect(deployState('queued')).toBe('running')
    expect(deployState('building')).toBe('running')
    expect(deployState('deploying')).toBe('running')
    expect(deployState('ready')).toBe('ready')
    expect(deployState('error')).toBe('failed')
    expect(deployState('cancelled')).toBe('failed')
    expect(deployState('superseded')).toBe('superseded')
  })

  it('is case-insensitive and survives a null status', () => {
    expect(deployState('BUILDING')).toBe('running')
    expect(deployState(null)).toBe('ready')
  })
})

describe('currentDeployment', () => {
  it('skips superseded rows, which say nothing about whether the app works', () => {
    const rows = [at({ id: 'new', status: 'superseded' }), at({ id: 'live', status: 'ready' })]
    expect(currentDeployment(rows)?.id).toBe('live')
  })

  it('falls back to the newest row when every row is superseded', () => {
    const rows = [at({ id: 'a', status: 'superseded' }), at({ id: 'b', status: 'superseded' })]
    expect(currentDeployment(rows)?.id).toBe('a')
  })

  it('is null for an app that has never deployed', () => {
    expect(currentDeployment([])).toBeNull()
  })
})

describe('deployAction', () => {
  it('refuses a second deploy while one is running', () => {
    const action = deployAction([at({ status: 'building' })], true)
    expect(action.disabled).toBe(true)
    expect(action.reason).toMatch(/already running/)
  })

  it('names the role as the reason when the person cannot deploy', () => {
    const action = deployAction([], false)
    expect(action.disabled).toBe(true)
    expect(action.reason).toMatch(/role/)
  })

  it('is pressable when the app is idle', () => {
    expect(deployAction([at({ status: 'ready' })], true)).toEqual({
      label: 'Deploy',
      disabled: false,
      reason: null,
    })
  })
})

describe('hasDeployInFlight', () => {
  it('is false for a history of finished deploys', () => {
    expect(hasDeployInFlight([at({ status: 'ready' }), at({ status: 'error' })])).toBe(false)
  })
})

describe('formatDuration', () => {
  it('reads as minutes and seconds past a minute', () => {
    expect(formatDuration(38)).toBe('38s')
    expect(formatDuration(420)).toBe('7m 00s')
    expect(formatDuration(252)).toBe('4m 12s')
  })

  it('does not invent a duration it does not have', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(-1)).toBe('—')
  })
})

describe('formatAgo', () => {
  // `now` is injected precisely so this can be asserted; a helper that read the
  // clock would be untestable, and clock guesses have misled this work before.
  const now = new Date('2026-09-13T19:00:00Z')

  it('counts up through the units', () => {
    expect(formatAgo('2026-09-13T18:59:30Z', now)).toBe('just now')
    expect(formatAgo('2026-09-13T18:30:00Z', now)).toBe('30m ago')
    expect(formatAgo('2026-09-13T15:00:00Z', now)).toBe('4h ago')
    expect(formatAgo('2026-09-11T19:00:00Z', now)).toBe('2d ago')
  })

  it('gives a date once "days ago" stops being useful', () => {
    expect(formatAgo('2026-08-01T19:00:00Z', now)).toBe('2026-08-01')
  })

  it('survives a missing or unparseable timestamp', () => {
    expect(formatAgo(null, now)).toBe('—')
    expect(formatAgo('not a date', now)).toBe('—')
  })
})

describe('commitSummary', () => {
  it('uses the first line of the commit message', () => {
    expect(commitSummary(at({ commitMessage: 'fix: the thing\n\nlong body' }))).toBe('fix: the thing')
  })

  it('truncates a subject too long for a cell', () => {
    const summary = commitSummary(at({ commitMessage: 'x'.repeat(100) }))
    expect(summary).toHaveLength(72)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('falls back to the short sha, then to why the deploy happened', () => {
    expect(commitSummary(at({ commitSha: '66788ad900d903f7500c01efd1ca542d7c41c713' }))).toBe(
      '66788ad'
    )
    expect(commitSummary(at({ source: 'service' }))).toBe('Redeploy')
  })
})
