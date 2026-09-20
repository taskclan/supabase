/**
 * One deployment's live build progress — the stages it moves through and the
 * streamed build log — for the Taskclan Cloud deployments screen.
 *
 * The deployments list answers "did it ship?"; this answers "watch it ship". It
 * polls the per-deployment log endpoint while the build is in flight (and stops
 * the moment it is terminal, so a finished build is not re-fetched forever), and
 * keeps the log pinned to the newest line unless the reader has scrolled up to
 * read something.
 */
import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from 'ui'

import { deployState } from '@/lib/taskclan/deployments'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

type StageState = 'done' | 'current' | 'pending' | 'failed'
interface BuildStage {
  key: string
  label: string
  state: StageState
}
interface LogPayload {
  id?: string
  status?: string
  phase?: string | null
  buildLog?: string | null
  stages?: BuildStage[]
  error?: string | null
  url?: string | null
}

const POLL_MS = 3000

const STAGE_ICON: Record<StageState, ReactNode> = {
  done: <Check size={13} className="text-brand" />,
  current: <Loader2 size={13} className="animate-spin text-brand" />,
  failed: <X size={13} className="text-destructive" />,
  pending: <div className="size-[7px] rounded-full bg-border-stronger" />,
}

export const TaskclanDeploymentDetail = ({
  projectRef,
  depId,
  initiallyRunning,
}: {
  projectRef: string
  depId: string
  /** Hint from the list row so the first render already knows to poll. */
  initiallyRunning?: boolean
}) => {
  const [data, setData] = useState<LogPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stickToBottom, setStickToBottom] = useState(true)
  const logEl = useRef<HTMLPreElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await taskclanFetch(`/api/taskclan/${projectRef}/deployments/${depId}/log`)
      const body = (await res.json()) as LogPayload & { detail?: string }
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
  }, [projectRef, depId])

  // Reset and reload whenever the selected deployment changes.
  useEffect(() => {
    setData(null)
    setLoading(true)
    setError(null)
    void load()
  }, [load])

  // Still building? Follow it. The list-row hint covers the gap before the first
  // fetch answers; after that the fetched status is the authority.
  const live =
    data?.status !== undefined ? deployState(data.status) === 'running' : !!initiallyRunning

  useEffect(() => {
    if (!live) return
    timer.current = setTimeout(() => void load(), POLL_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [live, load, data])

  // Keep the newest output in view — unless the reader scrolled up to read back.
  useEffect(() => {
    if (stickToBottom && logEl.current) logEl.current.scrollTop = logEl.current.scrollHeight
  }, [data?.buildLog, stickToBottom])

  const onLogScroll = () => {
    const el = logEl.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setStickToBottom(atBottom)
  }

  const stages = useMemo<BuildStage[]>(() => data?.stages ?? [], [data])
  const log = data?.buildLog ?? ''

  return (
    <div className="flex flex-col gap-4 rounded-md border border-default bg-surface-100 p-4">
      {/* Stages */}
      {stages.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {stages.map((s) => (
            <li
              key={s.key}
              className={cn(
                'flex items-center gap-2.5 text-sm',
                s.state === 'pending' && 'text-foreground-lighter',
                s.state === 'current' && 'text-foreground',
                s.state === 'done' && 'text-foreground-light',
                s.state === 'failed' && 'text-destructive'
              )}
            >
              <span className="flex size-4 items-center justify-center">{STAGE_ICON[s.state]}</span>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {data?.error && (
        <p className="rounded border border-destructive-300 bg-destructive-200/40 px-3 py-2 text-xs text-destructive-600">
          {data.error}
        </p>
      )}

      {/* Build log */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-foreground-lighter">Build log</span>
          {live && (
            <span className="flex items-center gap-1.5 text-xs text-brand">
              <Loader2 size={11} className="animate-spin" /> streaming
            </span>
          )}
        </div>
        {loading && !data ? (
          <p className="text-sm text-foreground-lighter">Loading…</p>
        ) : error ? (
          <p className="text-sm text-warning">{error}</p>
        ) : log.trim().length === 0 ? (
          <p className="rounded border border-default bg-background px-3 py-6 text-center text-sm text-foreground-lighter">
            {live ? 'Waiting for build output…' : 'No build output was recorded for this deployment.'}
          </p>
        ) : (
          <div className="relative">
            <pre
              ref={logEl}
              onScroll={onLogScroll}
              className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded border border-default bg-[#0b0b0d] p-3 font-mono text-[11.5px] leading-relaxed text-[#d4d4d8]"
            >
              {log}
            </pre>
            {!stickToBottom && live && (
              <button
                type="button"
                onClick={() => setStickToBottom(true)}
                className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-surface-300 px-2.5 py-1 text-[11px] text-foreground shadow"
              >
                <ChevronDown size={12} /> Follow
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
