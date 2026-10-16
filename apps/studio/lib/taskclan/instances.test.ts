import { describe, expect, it } from 'vitest'

import {
  availabilityMessage,
  clampMaxInstances,
  defaultInstanceId,
  describeCost,
  describeInstance,
  formatHourly,
  formatMonthly,
  type InstanceType,
} from './instances'

/**
 * The clamp is the part worth testing hardest.
 *
 * The engine does not reject an out-of-range instance count — it rewrites it and
 * returns success. So if this drifts from the engine's rule, the form reports
 * having provisioned a number that was never provisioned, and nothing anywhere
 * raises an error. The expectations below are transcribed from
 * `deploy-service/route.ts`, not from what seemed reasonable.
 */

const info = { max: 5, ceiling: 10 }

describe('clampMaxInstances', () => {
  it('is exactly one instance when autoscale is off', () => {
    // The engine's rule, not a default we picked: `autoscale ? … : 1`.
    expect(clampMaxInstances(7, false, info)).toBe(1)
    expect(clampMaxInstances(1, false, info)).toBe(1)
  })

  it('never returns fewer than two when autoscale is on', () => {
    // Autoscaling to a maximum of one is a contradiction, and the engine floors
    // at 2 rather than honouring it.
    expect(clampMaxInstances(1, true, info)).toBe(2)
    expect(clampMaxInstances(0, true, info)).toBe(2)
    expect(clampMaxInstances(-3, true, info)).toBe(2)
  })

  it('binds on the plan limit when the plan is the tighter of the two', () => {
    // max 5 < ceiling 10, so 5 wins. Asking for 8 here would be rejected
    // outright by computeEntitlementError, so the form must not offer it.
    expect(clampMaxInstances(8, true, { max: 5, ceiling: 10 })).toBe(5)
  })

  it('binds on the platform ceiling when the ceiling is the tighter of the two', () => {
    // An enterprise plan can carry a max above the hard platform limit; the
    // limit still wins.
    expect(clampMaxInstances(40, true, { max: 100, ceiling: 10 })).toBe(10)
  })

  it('passes an in-range request through untouched', () => {
    expect(clampMaxInstances(3, true, info)).toBe(3)
    expect(clampMaxInstances(5, true, info)).toBe(5)
  })

  it('falls back to three for a non-integer rather than propagating NaN', () => {
    // An empty number input reads as NaN. Math.min(NaN, …) is NaN, which would
    // reach the engine as `maxInstances: null` and land on its own fallback —
    // a different number from the one on screen.
    expect(clampMaxInstances(Number.NaN, true, info)).toBe(3)
    expect(clampMaxInstances(2.5, true, info)).toBe(3)
  })

  it('still respects a plan limit below the fallback', () => {
    // A plan capped at 2 must not get 3 just because the input was empty.
    expect(clampMaxInstances(Number.NaN, true, { max: 2, ceiling: 10 })).toBe(2)
  })
})

const size = (over: Partial<InstanceType> = {}): InstanceType => ({
  id: 'standard-1',
  label: 'Standard',
  vcpu: '1/2 vCPU',
  memory: '4 GB',
  disk: '8 GB',
  hourlyUsd: 0.0123,
  monthlyUsd: 8.98,
  minPlan: 'free',
  locked: false,
  ...over,
})

describe('defaultInstanceId', () => {
  it('takes the catalogue default when the plan can provision it', () => {
    const types = [size({ id: 'basic' }), size({ id: 'standard-1' })]
    expect(defaultInstanceId({ types, default: 'standard-1' })).toBe('standard-1')
  })

  it('falls back to the largest size the plan allows, not the smallest', () => {
    // The default encodes "what most apps need". When a plan caps below it the
    // nearest honest answer is the cap.
    const types = [
      size({ id: 'basic' }),
      size({ id: 'standard-1' }),
      size({ id: 'standard-4', locked: true }),
    ]
    expect(defaultInstanceId({ types, default: 'standard-4' })).toBe('standard-1')
  })

  it('does not invent an id when every size is locked', () => {
    const types = [size({ id: 'basic', locked: true })]
    expect(defaultInstanceId({ types, default: 'standard-4' })).toBe('basic')
  })

  it('returns empty rather than undefined for an empty catalogue', () => {
    expect(defaultInstanceId({ types: [], default: 'x' })).toBe('')
  })
})

describe('money', () => {
  it('formats the way the engine console formats, so prices match during the swap', () => {
    // Transcribed from the engine's fmtHourly/fmtMonthly. Both consoles are
    // live against one price list, so a mismatch reads as a pricing bug.
    expect(formatHourly(0.0123)).toBe('$0.012')
    expect(formatHourly(1.5)).toBe('$1.50')
    expect(formatMonthly(8.98)).toBe('$8.98')
    expect(formatMonthly(64.4)).toBe('$64')
  })
})

describe('describeInstance', () => {
  it('marks a locked size with the plan that unlocks it', () => {
    expect(describeInstance(size({ locked: true, minPlan: 'pro' }))).toContain('Pro+')
  })

  it('leaves an available size unqualified', () => {
    expect(describeInstance(size())).not.toContain('+')
  })
})

describe('describeCost', () => {
  it('says CPU is extra, because the headline rate excludes it', () => {
    // The hourly figure is memory + disk only. Presenting it as the whole cost
    // would understate every bill.
    expect(describeCost(size(), true)).toContain('CPU on actual use')
  })

  it('omits the scale-to-zero claim when the platform does not do it', () => {
    expect(describeCost(size(), false)).not.toContain('scales to zero')
  })
})

describe('availabilityMessage', () => {
  it('says nothing before the user has typed', () => {
    expect(availabilityMessage(null, { typed: false }).tone).toBe('idle')
  })

  it('distinguishes reserved from malformed, since the fixes differ', () => {
    const reserved = availabilityMessage(
      { valid: false, available: false, subdomain: 'www', host: 'www.x', reason: 'reserved' },
      { typed: true }
    )
    expect(reserved.tone).toBe('error')
    expect(reserved.text).toContain('reserved')

    const invalid = availabilityMessage(
      { valid: false, available: false, subdomain: '', host: '', reason: 'invalid' },
      { typed: true }
    )
    expect(invalid.text).toContain('letters, numbers and hyphens')
    expect(invalid.text).not.toContain('reserved')
  })

  it('names the host that is taken rather than saying "unavailable"', () => {
    const taken = availabilityMessage(
      { valid: true, available: false, subdomain: 'api', host: 'api.cloud.taskclan.com' },
      { typed: true }
    )
    expect(taken.tone).toBe('error')
    expect(taken.text).toContain('api.cloud.taskclan.com')
  })

  it('confirms with the actual host so the user sees their URL before creating', () => {
    const ok = availabilityMessage(
      { valid: true, available: true, subdomain: 'shop', host: 'shop.cloud.taskclan.com' },
      { typed: true }
    )
    expect(ok.tone).toBe('ok')
    expect(ok.text).toContain('shop.cloud.taskclan.com')
  })

  it('reports checking in progress rather than flashing a stale verdict', () => {
    // Without this the previous name's "available" stays on screen while the
    // new name is in flight, which is the window where someone clicks create.
    const stale = { valid: true, available: true, subdomain: 'a', host: 'a.x' }
    expect(availabilityMessage(stale, { typed: true, checking: true }).tone).toBe('checking')
  })
})
