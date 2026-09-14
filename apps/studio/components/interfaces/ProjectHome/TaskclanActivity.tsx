/**
 * The container's request activity, on the project home.
 *
 * The self-hosted equivalent of Supabase's "Total Requests / Success Rate"
 * panel, drawn from the Taskclan app's own container telemetry rather than from
 * the five managed services a container does not run. Requests, success rate,
 * uptime, and a per-bucket bar chart of requests over the window.
 */
import { useParams } from 'common'
import { useEffect, useState } from 'react'
import { cn } from 'ui'
import { ShimmeringLoader } from 'ui-patterns/ShimmeringLoader'

type Range = '1h' | '24h' | '7d' | '30d'
const RANGES: Range[] = ['1h', '24h', '7d', '30d']

interface Activity {
  configured: boolean
  requests: number
  errors: number
  disconnected: number
  successRatePct: number | null
  requestsPerMinute: number | null
  uptimePct: number | null
  series: Array<{ t: string; requests: number; errors: number }>
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

export const TaskclanActivity = () => {
  const { ref } = useParams()
  const [range, setRange] = useState<Range>('24h')
  const [data, setData] = useState<Activity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!ref) return
    let live = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/taskclan/${ref}/metrics?range=${range}`)
        const body = await res.json()
        if (!live) return
        if (!res.ok) setError(true)
        else {
          setData(body as Activity)
          setError(false)
        }
      } catch {
        if (live) setError(true)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [ref, range])

  // Silent when metrics are not wired up or unreachable — an app with no
  // traffic yet should show the rest of the home, not an error where a chart
  // would be.
  if (error) return null
  if (!loading && (!data || !data.configured)) return null

  const peak = data ? Math.max(1, ...data.series.map((p) => p.requests)) : 1

  return (
    <div className="rounded-md border border-default bg-surface-100 p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-6">
          {loading || !data ? (
            <ShimmeringLoader className="h-9 w-56" />
          ) : (
            <>
              <div>
                <span className="text-2xl font-medium tabular-nums">{fmt(data.requests)}</span>
                <span className="ml-2 text-sm text-foreground-light">Requests</span>
              </div>
              {data.successRatePct !== null && (
                <div>
                  <span
                    className={cn(
                      'text-2xl font-medium tabular-nums',
                      data.successRatePct >= 99.5
                        ? 'text-brand'
                        : data.successRatePct >= 95
                          ? 'text-foreground'
                          : 'text-warning'
                    )}
                  >
                    {data.successRatePct.toFixed(1)}%
                  </span>
                  <span className="ml-2 text-sm text-foreground-light">Success</span>
                </div>
              )}
              {data.uptimePct !== null && (
                <div className="hidden sm:block">
                  <span className="text-2xl font-medium tabular-nums">
                    {data.uptimePct.toFixed(data.uptimePct >= 99.95 ? 2 : 1)}%
                  </span>
                  <span className="ml-2 text-sm text-foreground-light">Uptime</span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-default p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                r === range
                  ? 'bg-surface-300 text-foreground'
                  : 'text-foreground-lighter hover:text-foreground'
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading || !data ? (
        <ShimmeringLoader className="h-24 w-full" />
      ) : data.series.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-lighter">
          No requests in this window.
        </p>
      ) : (
        <div className="flex h-24 items-end gap-1.5" aria-hidden>
          {data.series.map((p) => {
            const h = Math.max(2, Math.round((p.requests / peak) * 96))
            // Each bucket gets an equal-width cell; the bar sits narrow and
            // centered inside it, so the chart reads as thin bars with air
            // between them (Supabase's look) rather than a solid block.
            return (
              <div key={p.t} className="flex flex-1 items-end justify-center">
                <div
                  className="w-[6px] max-w-full rounded-sm bg-brand/70"
                  style={{ height: `${h}px` }}
                  title={`${new Date(p.t).toLocaleString()} — ${p.requests} requests${p.errors ? `, ${p.errors} errors` : ''}`}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
