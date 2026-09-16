import { Info } from 'lucide-react'
import { parseAsJson, useQueryStates } from 'nuqs'
import React, { useMemo } from 'react'
import { cn, Skeleton, Tooltip, TooltipContent, TooltipTrigger } from 'ui'

import { useQueryPerformanceQuery } from './useQueryPerformanceQuery'
import { NumericFilter } from '@/components/interfaces/Reports/v2/ReportsNumericFilter'

/**
 * What to show when the number is not known.
 *
 * These read as measurements, so they must not be invented. With the query
 * failing — pg_stat_statements missing, for one — every fallback below
 * resolved and the page reported "0 Slow Queries / 0% Cache Hit Rate / 0 Avg.
 * Rows Per Call". A real zero and no answer at all are different facts, and
 * 0% cache hit rate in particular reads as an emergency rather than as silence.
 */
const UNKNOWN = '—'

export const QueryPerformanceMetrics = () => {
  const {
    data: queryMetrics,
    isLoading,
    error,
  } = useQueryPerformanceQuery({ preset: 'queryMetrics' })

  // `error` is a string on this hook, not a react-query flag.
  const isError = Boolean(error)

  const [, setSearchParams] = useQueryStates({
    totalTimeFilter: parseAsJson<NumericFilter | null>((value) =>
      value === null || value === undefined ? null : (value as NumericFilter)
    ),
  })

  const stats = useMemo(() => {
    const slowQueriesTitle = queryMetrics?.[0]?.slow_queries === 1 ? 'Slow Query' : 'Slow Queries'
    const slowQueriesValue = isError ? UNKNOWN : queryMetrics?.[0]?.slow_queries || '0'

    return [
      {
        title: slowQueriesTitle,
        value: slowQueriesValue,
        onClick: () => {
          setSearchParams({
            totalTimeFilter: {
              operator: '>',
              value: 1000,
            } as NumericFilter,
          })
        },
      },
      {
        title: 'Cache Hit Rate',
        value: isError ? UNKNOWN : queryMetrics?.[0]?.cache_hit_rate || '0%',
        tooltip:
          'Percentage of data read from cache vs disk. Higher is better - it means faster queries and less database load.',
      },
      {
        title: 'Avg. Rows Per Call',
        value: isError ? UNKNOWN : queryMetrics?.[0]?.avg_rows_per_call || '0',
        tooltip:
          'Average number of rows returned per query execution. Helps identify queries that return too much or too little data.',
      },
    ]
  }, [queryMetrics, isError, setSearchParams])

  return (
    <section className="px-6 pt-2 pb-4 flex flex-wrap gap-x-6 gap-y-2 w-full">
      {stats.map((card, i) => (
        <React.Fragment key={i}>
          <div
            className={cn('flex items-baseline gap-2 heading-subSection text-foreground-light', {
              'cursor-pointer hover:text-foreground transition-colors': card.onClick,
            })}
            onClick={card.onClick}
          >
            {isLoading ? (
              <Skeleton className="h-5 w-24" />
            ) : (
              <>
                <span className="text-foreground">{card.value}</span>
                <span className="flex items-center gap-1">
                  {card.title}
                  {(card.title === 'Slow Queries' || card.title === 'Slow Query') && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          tabIndex={0}
                          aria-label="How are slow queries calculated?"
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface-200 text-foreground-lighter transition-colors hover:bg-surface-300 hover:text-foreground focus-ring"
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                        >
                          <Info size={12} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-xs text-xs">
                        Slow queries are those with total execution time (execution time + planning
                        time) greater than 1000ms.
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {card.tooltip && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          tabIndex={0}
                          aria-label={`What is ${card.title}?`}
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface-200 text-foreground-lighter transition-colors hover:bg-surface-300 hover:text-foreground focus-ring"
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                        >
                          <Info size={12} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="max-w-xs text-xs">
                        {card.tooltip}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </>
            )}
          </div>
          {i < stats.length - 1 && <span className="text-foreground-muted">/</span>}
        </React.Fragment>
      ))}
    </section>
  )
}
