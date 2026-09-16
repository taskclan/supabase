/**
 * A measured zero and no measurement are different facts.
 *
 * Every metric here fell back with `||`, so a failed query rendered
 * "0 Slow Queries / 0% Cache Hit Rate / 0 Avg. Rows Per Call" — three numbers
 * the page had not been told. 0% cache hit rate is the worst of them: it reads
 * as a database in trouble rather than as silence, and the usual cause is
 * simply that pg_stat_statements is not installed.
 *
 * Both halves are asserted. Replacing every zero with a dash would be the same
 * mistake pointing the other way, since zero slow queries is good news worth
 * showing.
 */
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QueryPerformanceMetrics } from './QueryPerformanceMetrics'
import { customRender } from '@/tests/lib/custom-render'

const result = vi.hoisted(() => ({
  value: { data: undefined as unknown, isLoading: false, error: '' as string },
}))

vi.mock('./useQueryPerformanceQuery', () => ({
  useQueryPerformanceQuery: () => result.value,
}))

vi.mock('nuqs', () => ({
  useQueryStates: () => [{}, vi.fn()],
  parseAsJson: () => ({ withDefault: () => ({}) }),
}))

describe('QueryPerformanceMetrics', () => {
  beforeEach(() => {
    result.value = { data: undefined, isLoading: false, error: '' }
  })

  it('shows a dash rather than zero when the query failed', () => {
    result.value = {
      data: undefined,
      isLoading: false,
      error: 'relation "pg_stat_statements" does not exist',
    }

    customRender(<QueryPerformanceMetrics />)

    expect(screen.getByText('Cache Hit Rate')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows a real zero as zero, because it is a measurement', () => {
    result.value = {
      data: [{ slow_queries: 0, cache_hit_rate: '95.53%', avg_rows_per_call: 0 }],
      isLoading: false,
      error: '',
    }

    customRender(<QueryPerformanceMetrics />)

    expect(screen.getByText('95.53%')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('reports the figures it was given', () => {
    result.value = {
      data: [{ slow_queries: 3, cache_hit_rate: '88.10%', avg_rows_per_call: 12 }],
      isLoading: false,
      error: '',
    }

    customRender(<QueryPerformanceMetrics />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('88.10%')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    // Singular when there is exactly one, which the title already handled.
    expect(screen.getByText('Slow Queries')).toBeInTheDocument()
  })
})
