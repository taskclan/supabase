/**
 * Runtime logs for a Taskclan Cloud app — the container's own stdout and stderr.
 *
 * The Deployments screen answers "did the build finish?"; this answers "why did
 * the app crash after it shipped?". A container that starts and then exits is the
 * most common first-deploy failure, and its reason lives only in the process's
 * own output — the edge just reports "internal error connecting to the port". So
 * the hint (a plain-English read of a known failure) sits above the raw lines,
 * because that reason is the whole point of the page.
 *
 * A crash-looping container keeps printing on every restart, so an opt-in
 * auto-refresh lets a reader watch the loop; it defaults off, because the usual
 * case is one dead container whose last lines already hold the answer.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, cn, Switch } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface ContainerLogLine {
  at: number
  level: string
  message: string
}
interface LogPayload {
  lines?: ContainerLogLine[]
  hint?: string | null
  note?: string | null
  error?: string
  detail?: string
}

const WINDOWS: { label: string; minutes: number }[] = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '12h', minutes: 720 },
]
const AUTO_REFRESH_MS = 5000

const isError = (level: string) => /err|fatal|crit/i.test(level)
const isWarn = (level: string) => /warn/i.test(level)

const fmtTime = (at: number) => {
  if (!at) return '--:--:--'
  const d = new Date(at)
  return d.toLocaleTimeString(undefined, { hour12: false })
}

export const TaskclanRuntimeLogs = ({ projectRef }: { projectRef: string }) => {
  const [data, setData] = useState<LogPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minutes, setMinutes] = useState(30)
  const [auto, setAuto] = useState(false)
  const [stickToBottom, setStickToBottom] = useState(true)
  const logEl = useRef<HTMLPreElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await taskclanFetch(`/api/taskclan/${projectRef}/container-logs?minutes=${minutes}`)
      const body = (await res.json()) as LogPayload
      if (!res.ok) setError(body.error ?? body.detail ?? `the Cloud API answered ${res.status}`)
      else {
        setError(null)
        setData(body)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectRef, minutes])

  // Refetch whenever the window changes (and on first mount).
  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Opt-in follow of a crash loop.
  useEffect(() => {
    if (!auto) return
    timer.current = setTimeout(() => void load(), AUTO_REFRESH_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [auto, load, data])

  // Newest output is where a crash reason lives; sort chronologically and keep
  // the tail in view unless the reader scrolled up to read back.
  const lines = useMemo(
    () => [...(data?.lines ?? [])].sort((a, b) => (a.at || 0) - (b.at || 0)),
    [data]
  )

  useEffect(() => {
    if (stickToBottom && logEl.current) logEl.current.scrollTop = logEl.current.scrollHeight
  }, [lines, stickToBottom])

  const onLogScroll = () => {
    const el = logEl.current
    if (!el) return
    setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: window, refresh, follow. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-md border border-default bg-surface-100 p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.minutes}
              type="button"
              onClick={() => setMinutes(w.minutes)}
              className={cn(
                'rounded px-2.5 py-1 text-xs transition',
                minutes === w.minutes
                  ? 'bg-surface-300 text-foreground'
                  : 'text-foreground-lighter hover:text-foreground'
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-foreground-light">
            <Switch checked={auto} onCheckedChange={setAuto} />
            Auto-refresh
          </label>
          <Button
            variant="default"
            icon={<RefreshCw size={14} className={cn(loading && 'animate-spin')} />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* The reason, when the output matches a known failure. */}
      {data?.hint && (
        <Admonition type="warning" title="This looks like the problem" className="mb-0">
          <p className="text-sm">{data.hint}</p>
        </Admonition>
      )}

      {error && (
        <Admonition type="warning" title="Could not reach Taskclan Cloud" className="mb-0">
          <p className="text-sm">{error}</p>
        </Admonition>
      )}

      {/* The output. */}
      {loading && !data ? (
        <p className="rounded-md border border-default bg-surface-100 px-4 py-8 text-center text-sm text-foreground-lighter">
          Loading logs…
        </p>
      ) : lines.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-default bg-surface-100 px-4 py-12 text-center">
          <AlertTriangle size={20} className="text-foreground-lighter" />
          <p className="max-w-md text-sm text-foreground-light">
            {data?.note ?? 'No container output in this window.'}
          </p>
          <p className="text-xs text-foreground-lighter">
            Try a longer window, or check the build log on the Deployments page if the app never
            started.
          </p>
        </div>
      ) : (
        <pre
          ref={logEl}
          onScroll={onLogScroll}
          className="max-h-[560px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-default bg-[#0b0b0d] p-4 font-mono text-[11.5px] leading-relaxed text-[#d4d4d8]"
        >
          {lines.map((l, i) => (
            <div
              key={`${l.at}-${i}`}
              className={cn(
                'flex gap-3',
                isError(l.level) && 'text-[#f87171]',
                isWarn(l.level) && 'text-[#fbbf24]'
              )}
            >
              <span className="shrink-0 select-none text-[#6b7280]">{fmtTime(l.at)}</span>
              <span className="min-w-0 flex-1">{l.message}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}
