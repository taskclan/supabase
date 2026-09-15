/**
 * Deployments for a Taskclan Cloud app.
 *
 * Studio's project screens are about a database. An app on Taskclan Cloud also
 * has a build pipeline, and until this page the only way to ship one was a
 * `curl` to the engine or approving an intent by hand — which meant "who can
 * deploy" was really "who has the Cloud API key", and nobody could see the
 * history without asking. Developers and DevOps deploy from here now.
 *
 * The key stays on the server: every call goes to /api/taskclan/{ref}/… , which
 * holds the credential and resolves the app by ref.
 */
import { useParams } from 'common'
import { CheckCircle2, CircleSlash, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Badge, Button, cn, Switch } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import { ConfirmationModal } from 'ui-patterns/Dialogs/ConfirmationModal'

import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import { PageLayout } from '@/components/layouts/PageLayout/PageLayout'
import { ProjectLayoutWithAuth } from '@/components/layouts/ProjectLayout'
import { ScaffoldContainer, ScaffoldSection } from '@/components/layouts/Scaffold'
import {
  commitSummary,
  currentDeployment,
  deployAction,
  deployState,
  formatAgo,
  formatDuration,
  hasDeployInFlight,
  type CloudDeployment,
  type DeployState,
} from '@/lib/taskclan/deployments'
import type { NextPageWithLayout } from '@/types'

/** While a build is running, follow it. Idle, stop asking. */
const POLL_WHILE_RUNNING_MS = 10_000

interface Payload {
  deployments?: CloudDeployment[]
  site?: { id: string; name: string; liveUrl: string | null }
  error?: string
  detail?: string
}

const STATE_STYLE: Record<DeployState, { label: string; className: string; icon: ReactNode }> = {
  running: {
    label: 'Building',
    className: 'text-brand',
    icon: <Loader2 size={14} className="animate-spin" />,
  },
  ready: {
    label: 'Ready',
    className: 'text-brand',
    icon: <CheckCircle2 size={14} />,
  },
  failed: {
    label: 'Failed',
    className: 'text-destructive',
    icon: <XCircle size={14} />,
  },
  superseded: {
    label: 'Superseded',
    className: 'text-foreground-lighter',
    icon: <CircleSlash size={14} />,
  },
}

const DeploymentsPage: NextPageWithLayout = () => {
  const { ref } = useParams()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [autoDeploy, setAutoDeploy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Survives re-renders so a poll started before a navigation cannot keep firing.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!ref) return
    try {
      const res = await fetch(`/api/taskclan/${ref}/deployments`)
      const body = (await res.json()) as Payload
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `the Cloud API answered ${res.status}`)
      } else {
        setError(null)
        setPayload(body)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [ref])

  useEffect(() => {
    void load()
  }, [load])

  const deployments = useMemo(() => payload?.deployments ?? [], [payload])
  const running = hasDeployInFlight(deployments)
  const current = currentDeployment(deployments)

  // Poll only while something is in flight. A dashboard that refetches forever
  // bills the container it is watching.
  useEffect(() => {
    if (!running) return
    timer.current = setTimeout(() => void load(), POLL_WHILE_RUNNING_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [running, load, payload])

  const action = deployAction(deployments, true)

  const deploy = useCallback(async () => {
    if (!ref) return
    setDeploying(true)
    try {
      const res = await fetch(`/api/taskclan/${ref}/deployments`, { method: 'POST' })
      const body = (await res.json()) as { error?: string; detail?: string }
      if (!res.ok) {
        toast.error(body.error ?? body.detail ?? `the deploy was refused (${res.status})`)
        return
      }
      toast.success('Deploy started — this page follows it')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDeploying(false)
    }
  }, [ref, load])

  const setMode = useCallback(
    async (next: boolean) => {
      if (!ref) return
      const previous = autoDeploy
      setAutoDeploy(next) // optimistic: the switch must feel like a switch
      try {
        const res = await fetch(`/api/taskclan/${ref}/deploy-mode`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: next ? 'auto' : 'manual' }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setAutoDeploy(previous)
          toast.error(body.error ?? 'could not change the deploy mode')
          return
        }
        toast.success(next ? 'Merges to the default branch will deploy' : 'Deploys are manual')
      } catch (e) {
        setAutoDeploy(previous)
        toast.error(e instanceof Error ? e.message : String(e))
      }
    },
    [ref, autoDeploy]
  )

  const liveUrl = payload?.site?.liveUrl ?? current?.url ?? null

  return (
    <PageLayout
      title="Deployments"
      subtitle="Ship this app and see what shipped before."
      primaryActions={
        <div className="flex items-center gap-3">
          <Button
            variant="default"
            icon={<RefreshCw size={14} className={cn(loading && 'animate-spin')} />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            loading={deploying}
            disabled={action.disabled || deploying}
            onClick={() => setConfirm(true)}
          >
            {action.label}
          </Button>
        </div>
      }
    >
      <ScaffoldContainer>
        <ScaffoldSection isFullWidth>
          {error && (
            <Admonition type="warning" title="Could not reach Taskclan Cloud" className="mb-6">
              <p className="text-sm">{error}</p>
            </Admonition>
          )}

          {/* What is live right now, before the history. The question people
              open this page with is "is it up?", not "what happened in July". */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-md border border-default bg-surface-100 px-5 py-4">
            <div className="flex items-center gap-3">
              {current ? (
                <span
                  className={cn(
                    'flex items-center gap-2 text-sm',
                    STATE_STYLE[deployState(current.status)].className
                  )}
                >
                  {STATE_STYLE[deployState(current.status)].icon}
                  {STATE_STYLE[deployState(current.status)].label}
                </span>
              ) : (
                <span className="text-sm text-foreground-lighter">No deploys yet</span>
              )}
              {current && (
                <span className="text-sm text-foreground-light">
                  {commitSummary(current)} · {formatAgo(current.createdAt)} ·{' '}
                  {formatDuration(current.durationSec)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-5">
              {liveUrl && (
                <a
                  href={liveUrl.startsWith('http') ? liveUrl : `https://${liveUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-foreground-light hover:text-foreground"
                >
                  Open app <ExternalLink size={13} />
                </a>
              )}
              <label className="flex items-center gap-2 text-sm text-foreground-light">
                <Switch checked={autoDeploy} onCheckedChange={(v) => void setMode(v)} />
                Deploy on merge
              </label>
            </div>
          </div>

          {loading && deployments.length === 0 ? (
            <p className="text-sm text-foreground-lighter">Loading deployments…</p>
          ) : deployments.length === 0 ? (
            <div className="rounded-md border border-dashed border-default px-5 py-10 text-center">
              <p className="text-sm text-foreground">This app has never been deployed.</p>
              <p className="mt-1 text-sm text-foreground-lighter">
                Deploy ships the app&apos;s linked repository and branch.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-default">
              <table className="w-full text-sm">
                <thead className="bg-surface-100 text-foreground-lighter">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-normal">Status</th>
                    <th className="px-4 py-2.5 text-left font-normal">Commit</th>
                    <th className="px-4 py-2.5 text-left font-normal">Branch</th>
                    <th className="px-4 py-2.5 text-left font-normal">Target</th>
                    <th className="px-4 py-2.5 text-right font-normal tabular-nums">Duration</th>
                    <th className="px-4 py-2.5 text-right font-normal tabular-nums">When</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((d) => {
                    const s = deployState(d.status)
                    return (
                      <tr key={d.id} className="border-t border-default align-top">
                        <td className="px-4 py-3">
                          <span className={cn('flex items-center gap-2', STATE_STYLE[s].className)}>
                            {STATE_STYLE[s].icon}
                            {STATE_STYLE[s].label}
                          </span>
                          {/* The engine writes failures for a person to read;
                              hiding them behind a log link is what made a
                              broken deploy look like a broken platform. */}
                          {d.error && (
                            <p className="mt-1 max-w-md text-xs text-foreground-lighter">
                              {d.error}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground">{commitSummary(d)}</td>
                        <td className="px-4 py-3 text-foreground-light">{d.branch ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={d.target === 'production' ? 'success' : 'default'}>
                            {d.target ?? 'production'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground-light">
                          {formatDuration(d.durationSec)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground-light">
                          {formatAgo(d.createdAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ScaffoldSection>
      </ScaffoldContainer>

      <ConfirmationModal
        visible={confirm}
        title="Deploy to production"
        confirmLabel="Deploy"
        confirmLabelLoading="Starting…"
        loading={deploying}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          void deploy()
        }}
      >
        <p className="text-sm text-foreground-light">
          This builds the app&apos;s linked repository and branch and replaces what is live. It
          takes a few minutes; this page follows it.
        </p>
      </ConfirmationModal>
    </PageLayout>
  )
}

DeploymentsPage.getLayout = (page) => (
  <DefaultLayout>
    <ProjectLayoutWithAuth>{page}</ProjectLayoutWithAuth>
  </DefaultLayout>
)

export default DeploymentsPage
