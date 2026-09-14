/**
 * The honest state for a database screen on an app that has no database.
 *
 * Most Taskclan apps (docs, static sites, services that keep no data in the
 * shared Postgres) have no per-app database role. Their Table/SQL/Database
 * screens used to throw "API error happened while trying to communicate with
 * the server" — an outage message for a non-problem. This says what is actually
 * true, and points at the screens that do work for such an app.
 *
 * `useTaskclanDbStatus` is the gate the DB layouts use. While the check is in
 * flight it returns `undefined`, so a layout renders its normal content and
 * only swaps to this panel once we know there is no database — no flash of an
 * empty editor.
 */
import { useParams } from 'common'
import { Database } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from 'ui'

type DbStatus = { configured: boolean; reason?: string } | undefined

export function useTaskclanDbStatus(): DbStatus {
  const { ref } = useParams()
  const [status, setStatus] = useState<DbStatus>(undefined)

  useEffect(() => {
    if (!ref) return
    let live = true
    setStatus(undefined)
    ;(async () => {
      try {
        const res = await fetch(`/api/taskclan/${ref}/db-status`)
        const body = await res.json()
        if (!live) return
        setStatus(res.ok ? body : { configured: true }) // fail open: on a check error, don't hide a real DB
      } catch {
        if (live) setStatus({ configured: true })
      }
    })()
    return () => {
      live = false
    }
  }, [ref])

  return status
}

export const TaskclanNoDatabase = () => {
  const { ref } = useParams()
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-lg bg-surface-200 text-foreground-lighter">
          <Database size={20} strokeWidth={1.5} />
        </div>
        <h2 className="text-base text-foreground">This app has no managed database</h2>
        <p className="mt-2 text-sm text-foreground-light">
          The Table editor, SQL editor and Database tools appear for apps that store data in
          Taskclan&apos;s managed Postgres. This app doesn&apos;t have one, so there is nothing to
          browse here.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button asChild type="default">
            <Link href={ref ? `/project/${ref}` : '/'}>App overview</Link>
          </Button>
          <Button asChild type="default">
            <Link href={ref ? `/project/${ref}/deployments` : '/'}>Deployments</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
