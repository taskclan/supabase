import { describe, expect, it } from 'vitest'

import { formatCredits, formatDuration, formatUsd, readableUsage } from './usage'

/**
 * Unit conversion, which fails quietly.
 *
 * A wrong divisor here does not throw. It renders a number that looks like a
 * bill, and the only reason anyone would notice is if they already knew what
 * the answer should be. The real values in these tests came from the live
 * endpoint, so the expected readings are checkable against what Cloud reports.
 */

describe('readableUsage', () => {
  it('converts seconds into units a person can check', () => {
    // 6,309,096 vCPU-seconds is what the org actually used in 30 days. Read as
    // seconds it means nothing; 1752.53 vCPU-hours is roughly "two and a half
    // cores, all month", which somebody can compare against what they run.
    const [line] = readableUsage([
      {
        metric: 'compute_vcpu_seconds',
        quantity: 6309096.272678749,
        credits: 216267,
        usd: 216.267,
      },
    ])

    expect(line.label).toBe('Compute')
    expect(line.amount).toBe('1,752.53 vCPU-hours')
  })

  it('puts the biggest spend first', () => {
    // The question the screen answers is where the money went, so the answer
    // should be the top row rather than wherever the metric sorts on name.
    const lines = readableUsage([
      { metric: 'build_seconds', quantity: 1216401, credits: 182477, usd: 182.477 },
      { metric: 'compute_vcpu_seconds', quantity: 6309096, credits: 216267, usd: 216.267 },
      { metric: 'compute_gb_seconds', quantity: 25556244, credits: 113850, usd: 113.85 },
    ])

    expect(lines.map((l) => l.label)).toEqual(['Compute', 'Build time', 'Memory'])
  })

  it('shows an unknown metric rather than hiding it', () => {
    // A metric Cloud starts emitting that this file has not learned yet. Ugly
    // is the right failure: dropping it would understate the bill, and nothing
    // would say so.
    const [line] = readableUsage([
      { metric: 'quantum_flux_seconds', quantity: 42, credits: 7, usd: 0.07 },
    ])

    expect(line.label).toBe('quantum_flux_seconds')
    expect(line.amount).toBe('42')
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0 minutes'],
    [45, '45 seconds'],
    [60, '1 minute'],
    [1800, '30 minutes'],
    [3600, '1 hour'],
    [1216401, '337.9 hours'],
  ])('reads %i seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })
})

describe('money and credits', () => {
  it('always shows two decimals, so a total never reads as a round number it is not', () => {
    expect(formatUsd(512.594)).toBe('$512.59')
    expect(formatUsd(10)).toBe('$10.00')
  })

  it('separates thousands in a credit balance', () => {
    // 9976488 is unreadable; the balance is the number people look at first.
    expect(formatCredits(9976488)).toBe('9,976,488')
  })

  it('does not render NaN as a price', () => {
    // An absent field arrives as undefined and becomes NaN on arithmetic.
    // "$NaN" on a billing screen is alarming in a way the real value is not.
    expect(formatUsd(Number.NaN)).toBe('$0.00')
    expect(formatCredits(Number.NaN)).toBe('0')
    expect(formatDuration(Number.NaN)).toBe('0 minutes')
  })
})
