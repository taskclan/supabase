/**
 * One deployment's build detail — its metadata, the stages it moved through, and
 * the streamed build log — on its own page, reached by tapping a row on the
 * Deployments list.
 *
 * Why a page rather than the panel this used to expand inline under the table: a
 * build log wants room, a URL you can share and reopen, and a back button. The
 * list stays a list; drilling into one build lands here.
 *
 * The metadata (commit, branch, target, timing) comes from the same deployments
 * list the table is built from — the engine has no per-deployment metadata
 * endpoint separate from the log — while the stages and log come from
 * TaskclanDeploymentDetail, which fetches them by id. A build older than the
 * recent history still loads its log; only the summary strip degrades.
 */
import { useParams } from 'common'
import { CheckCircle2, CircleSlash, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, cn } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import { TaskclanDeploymentDetail } from '@/components/interfaces/Deployments/TaskclanDeploymentDetail'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import { PageLayout } from '@/components/layouts/PageLayout/PageLayout'
import { ProjectLayoutWithAuth } from '@/components/layouts/ProjectLayout'
import { ScaffoldContainer, ScaffoldSection } from '@/components/layouts/Scaffold'
import {
  commitSummary,
  deployState,
  formatAgo,
  formatDuration,
  type CloudDeployment,
  type DeployState,
} from '@/lib/taskclan/deployments'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import type { NextPageWithLayout } from '@/types'

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
  ready: { label: 'Ready', className: 'text-brand', icon: <CheckCircle2 size={14} /> },
  failed: { label: 'Failed', className: 'text-destructive', icon: <XCircle size={14} /> },
  superseded: {
    label: 'Superseded',
    className: 'text-foreground-lighter',
    icon: <CircleSlash size={14} />,
  },
}

const BuildDetailPage: NextPageWithLayout = () => {
  const { ref, depId } = useParams()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!ref) return
    try {
      const res = await taskclanFetch(`/api/taskclan/${ref}/deployments`)
      const body = (await res.json()) as Payload
      if (!res.ok) setError(body.detail ?? body.error ?? `the Cloud API answered ${res.status}`)
      else {
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

  const dep = useMemo(
    () => payload?.deployments?.find((d) => d.id === depId) ?? null,
    [payload, depId]
  )
  const state = dep ? deployState(dep.status) : null
  const liveUrl = payload?.site?.liveUrl ?? dep?.url ?? null

  return (
    <PageLayout
      title={dep ? commitSummary(dep) : 'Build detail'}
      subtitle={
        dep
          ? `${formatAgo(dep.createdAt)} · ${formatDuration(dep.durationSec)}`
          : 'One deployment’s stages and build log.'
      }
      breadcrumbs={[
        { label: 'Deployments', href: ref ? `/project/${ref}/deployments` : undefined },
      ]}
      primaryActions={
        liveUrl ? (
          <a
            href={liveUrl.startsWith('http') ? liveUrl : `https://${liveUrl}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-foreground-light hover:text-foreground"
          >
            Open app <ExternalLink size={13} />
          </a>
        ) : undefined
      }
    >
      <ScaffoldContainer>
        <ScaffoldSection isFullWidth>
          {error && (
            <Admonition type="warning" title="Could not reach Taskclan Cloud" className="mb-6">
              <p className="text-sm">{error}</p>
            </Admonition>
          )}

          {/* Summary strip — the same facts as the row, given room to breathe. */}
          {dep && state && (
            <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-default bg-surface-100 px-5 py-4 text-sm">
              <span className={cn('flex items-center gap-2', STATE_STYLE[state].className)}>
                {STATE_STYLE[state].icon}
                {STATE_STYLE[state].label}
              </span>
              <span className="text-foreground">{commitSummary(dep)}</span>
              <span className="text-foreground-light">{dep.branch ?? '—'}</span>
              <Badge variant={dep.target === 'production' ? 'success' : 'default'}>
                {dep.target ?? 'production'}
              </Badge>
              <span className="tabular-nums text-foreground-light">
                {formatDuration(dep.durationSec)}
              </span>
              <span className="tabular-nums text-foreground-light">{formatAgo(dep.createdAt)}</span>
            </div>
          )}

          {!dep && !loading && !error && (
            <Admonition type="note" title="Older build" className="mb-6">
              <p className="text-sm">
                This build isn’t in the recent history, so its summary isn’t shown — the log below
                still loads.
              </p>
            </Admonition>
          )}

          {ref && depId ? (
            <TaskclanDeploymentDetail
              projectRef={ref}
              depId={depId}
              initiallyRunning={state === 'running'}
            />
          ) : (
            <p className="text-sm text-foreground-lighter">Loading…</p>
          )}
        </ScaffoldSection>
      </ScaffoldContainer>
    </PageLayout>
  )
}

BuildDetailPage.getLayout = (page) => (
  <DefaultLayout>
    <ProjectLayoutWithAuth>{page}</ProjectLayoutWithAuth>
  </DefaultLayout>
)

export default BuildDetailPage
