/**
 * What this organisation has actually spent.
 *
 * Upstream's Usage screen is built around Supabase's product: compute hours per
 * dedicated instance, database size, monthly active users, egress against a
 * plan quota. None of those describe Taskclan Cloud, which meters containers by
 * the second and bills prepaid credits, so the page could only show an error
 * and a wall of copy about a product the reader is not using. It also stated a
 * billing period of 01 Jan 1970, because there was no period to state.
 *
 * This shows what Cloud actually measures, in units somebody can check against
 * what they think they are running.
 *
 * Deliberately not a quota screen. Cloud has no per-plan usage allowance to
 * show progress against; it has a balance that goes down. Borrowing upstream's
 * progress bars would imply a limit that does not exist.
 */
import { useEffect, useState } from 'react'
import { Card, CardContent } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import { GenericSkeletonLoader } from 'ui-patterns/ShimmeringLoader'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import {
  formatCredits,
  formatUsd,
  readableUsage,
  type ReadableUsageLine,
  type UsageLine,
} from '@/lib/taskclan/usage'

interface CreditsResponse {
  plan?: string
  balanceCredits?: number
  balanceUsd?: number
  usage?: { periodDays?: number; lines?: UsageLine[]; totalCredits?: number; totalUsd?: number }
}

export const TaskclanUsage = () => {
  const [data, setData] = useState<CreditsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch('/api/taskclan/credits')
        const body = await res.json()
        if (!live) return
        if (!res.ok) setError(body?.error ?? `Taskclan Cloud answered ${res.status}`)
        else setData(body as CreditsResponse)
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not reach Taskclan Cloud')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  if (error) {
    return (
      <div className="p-6">
        <Admonition type="warning" title="Could not load usage">
          {error}
        </Admonition>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6">
        <GenericSkeletonLoader />
      </div>
    )
  }

  const lines: ReadableUsageLine[] = readableUsage(data.usage?.lines ?? [])
  const periodDays = data.usage?.periodDays ?? 30

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Plan" value={data.plan ? titleCase(data.plan) : 'Unknown'} />
        <Stat
          label="Credit balance"
          value={formatCredits(data.balanceCredits ?? 0)}
          hint={formatUsd(data.balanceUsd ?? 0)}
        />
        <Stat
          label={`Spent in ${periodDays} days`}
          value={formatUsd(data.usage?.totalUsd ?? 0)}
          hint={`${formatCredits(data.usage?.totalCredits ?? 0)} credits`}
        />
      </div>

      <div>
        <h3 className="mb-1 text-foreground">Metered usage</h3>
        <p className="mb-4 text-sm text-foreground-light">
          What the last {periodDays} days were spent on. Containers are metered per second and cost
          nothing while asleep, so an app nobody is using does not appear here.
        </p>

        {lines.length === 0 ? (
          // Genuinely nothing used, which is different from failing to load and
          // is worth saying plainly rather than showing an empty table.
          <Card>
            <CardContent className="py-6 text-sm text-foreground-light">
              No metered usage in the last {periodDays} days.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-muted text-left text-foreground-lighter">
                    <th className="px-4 py-2.5 font-normal">Metric</th>
                    <th className="px-4 py-2.5 font-normal">Used</th>
                    <th className="px-4 py-2.5 text-right font-normal">Credits</th>
                    <th className="px-4 py-2.5 text-right font-normal">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.metric} className="border-b border-muted last:border-0">
                      <td className="px-4 py-3 text-foreground">{line.label}</td>
                      <td className="px-4 py-3 text-foreground-light">{line.amount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground-light">
                        {formatCredits(line.credits)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {formatUsd(line.usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-foreground-lighter">{label}</p>
        <p className="mt-1 text-2xl text-foreground">{value}</p>
        {hint && <p className="text-sm text-foreground-light">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
