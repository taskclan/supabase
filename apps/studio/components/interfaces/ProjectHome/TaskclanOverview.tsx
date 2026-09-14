/**
 * The project home Overview for a Taskclan Cloud app.
 *
 * Upstream's status/compute/region cards live behind IS_PLATFORM and are wired
 * to Supabase's infra APIs. This is the self-hosted equivalent, wired to
 * Taskclan Cloud: the same at-a-glance answer to "is it up, what does it run
 * on, where's its code, when did it last ship?" without the Supabase-only cards
 * (per-app backups and migrations) that a shared database cannot honestly fill.
 */
import { useParams } from 'common'
import { CheckCircle2, CircleSlash, ExternalLink, GitBranch, Github, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { Badge, cn } from 'ui'
import { ShimmeringLoader } from 'ui-patterns/ShimmeringLoader'

import { formatAgo, formatDuration } from '@/lib/taskclan/deployments'
import type { Overview } from '@/lib/taskclan/overview'

const TONE: Record<Overview['status']['tone'], string> = {
  healthy: 'text-brand',
  warning: 'text-warning',
  down: 'text-destructive',
  neutral: 'text-foreground-light',
}

function Card({
  label,
  children,
  href,
}: {
  label: string
  children: ReactNode
  href?: string | null
}) {
  const body = (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md border border-default bg-surface-100 px-4 py-3.5',
        href && 'transition-colors hover:bg-surface-200'
      )}
    >
      <span className="text-xs uppercase tracking-wide text-foreground-lighter">{label}</span>
      <span className="flex items-center gap-1.5 text-sm text-foreground">{children}</span>
    </div>
  )
  return href ? (
    <Link href={href} className="contents">
      {body}
    </Link>
  ) : (
    body
  )
}

export const TaskclanOverview = () => {
  const { ref } = useParams()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ref) return
    let live = true
    ;(async () => {
      try {
        const res = await fetch(`/api/taskclan/${ref}/overview`)
        const body = await res.json()
        if (!live) return
        if (!res.ok) setError(body.detail ?? body.error ?? `the Cloud API answered ${res.status}`)
        else {
          setData(body as Overview)
          setError(null)
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

  if (loading) {
    return (
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <ShimmeringLoader key={i} className="h-[68px] w-full" />
        ))}
      </div>
    )
  }

  // Silent on error rather than shouting: the title above still renders, and a
  // transient Cloud hiccup should not replace the whole home page with a
  // stack trace. The deploy list carries the louder, actionable version.
  if (error || !data) return null

  const statusIcon =
    data.status.tone === 'healthy' ? (
      <CheckCircle2 size={14} />
    ) : data.status.tone === 'warning' || data.status.tone === 'down' ? (
      <XCircle size={14} />
    ) : (
      <CircleSlash size={14} />
    )

  return (
    <div className="mt-8 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card label="Status">
          <span className={cn('flex items-center gap-1.5', TONE[data.status.tone])}>
            {statusIcon}
            {data.status.label}
          </span>
        </Card>

        <Card label="Compute">
          <Badge variant="default">{data.compute}</Badge>
        </Card>

        <Card label="Region">{data.region}</Card>

        <Card label="Repository" href={data.repo ? `https://github.com/${data.repo}` : null}>
          {data.repo ? (
            <>
              <Github size={14} className="text-foreground-lighter" />
              {data.repo}
            </>
          ) : (
            <span className="text-foreground-lighter">No repository connected</span>
          )}
        </Card>

        <Card label="Branch">
          {data.branch ? (
            <>
              <GitBranch size={14} className="text-foreground-lighter" />
              {data.branch}
            </>
          ) : (
            <span className="text-foreground-lighter">—</span>
          )}
        </Card>

        <Card label="Last deploy" href={`/project/${ref}/deployments`}>
          {data.lastDeploy ? (
            <span className="truncate">
              {data.lastDeploy.commit ?? data.lastDeploy.state} ·{' '}
              <span className="text-foreground-light">
                {formatAgo(data.lastDeploy.when)} · {formatDuration(data.lastDeploy.durationSec)}
              </span>
            </span>
          ) : (
            <span className="text-foreground-lighter">Never deployed</span>
          )}
        </Card>
      </div>

      {data.liveUrl && (
        <a
          href={data.liveUrl}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit items-center gap-1.5 text-sm text-foreground-light hover:text-foreground"
        >
          {data.liveUrl.replace(/^https?:\/\//, '')}
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  )
}
