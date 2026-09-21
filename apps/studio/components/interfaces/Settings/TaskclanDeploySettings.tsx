/**
 * Deployment settings for a Taskclan Cloud app.
 *
 * "Deploy on merge" used to sit inline on the Deployments screen, where it read
 * as a per-visit control rather than a setting and never showed the app's real
 * mode (it always rendered off). It belongs here, in settings: the toggle loads
 * the actual mode from the engine and writing it is one call.
 *
 * auto  — a merge to the app's default branch ships automatically.
 * manual — a merge opens a deploy that waits for someone to approve it.
 */
import { useParams } from 'common'
import { GitMerge, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Switch } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

type Mode = 'auto' | 'manual'

export const TaskclanDeploySettings = () => {
  const { ref } = useParams()
  const [mode, setMode] = useState<Mode | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ref) return
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch(`/api/taskclan/${ref}/deploy-mode`)
        const body = (await res.json()) as { mode?: Mode; error?: string; detail?: string }
        if (!live) return
        if (!res.ok) setError(body.error ?? body.detail ?? `the Cloud API answered ${res.status}`)
        else {
          setError(null)
          setMode(body.mode === 'auto' ? 'auto' : 'manual')
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [ref])

  const onToggle = useCallback(
    async (next: boolean) => {
      if (!ref) return
      const nextMode: Mode = next ? 'auto' : 'manual'
      const previous = mode
      setMode(nextMode) // optimistic: a switch must feel like a switch
      setSaving(true)
      try {
        const res = await taskclanFetch(`/api/taskclan/${ref}/deploy-mode`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: nextMode }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setMode(previous)
          toast.error(body.error ?? 'could not change the deploy mode')
          return
        }
        toast.success(
          nextMode === 'auto'
            ? 'Merges to the default branch will deploy'
            : 'Deploys now wait for approval'
        )
      } catch (e) {
        setMode(previous)
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    [ref, mode]
  )

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8">
      <div className="flex flex-col gap-1">
        <h3 className="text-base text-foreground">Deployments</h3>
        <p className="text-sm text-foreground-light">
          Control how this app ships when its repository changes.
        </p>
      </div>

      {error ? (
        <Admonition type="warning" title="Could not reach Taskclan Cloud">
          <p className="text-sm">{error}</p>
        </Admonition>
      ) : (
        <div className="rounded-md border border-default bg-surface-100">
          <div className="flex items-start justify-between gap-6 p-5">
            <div className="flex gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-200 text-foreground-light">
                <GitMerge size={16} />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-foreground">Deploy on merge</p>
                <p className="max-w-xl text-sm text-foreground-light">
                  {mode === 'auto'
                    ? 'On — a merge to the default branch deploys automatically.'
                    : 'Off — a merge opens a deployment that waits for you to approve it.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              {(loading || saving) && (
                <Loader2 size={14} className="animate-spin text-foreground-lighter" />
              )}
              <Switch
                checked={mode === 'auto'}
                disabled={loading || saving || mode === null}
                onCheckedChange={(v) => void onToggle(v)}
              />
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-foreground-lighter">
        Manual is the safe default: a build only replaces what is live once you approve it on the
        Deployments page. Turn this on for an app you want to ship on every merge.
      </p>
    </div>
  )
}
