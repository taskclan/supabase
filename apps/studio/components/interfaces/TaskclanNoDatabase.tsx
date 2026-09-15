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
import { Check, Database } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from 'ui'

import { TaskclanProvisionDatabase } from './TaskclanProvisionDatabase'

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
  const [provisioned, setProvisioned] = useState(false)

  if (provisioned) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Check size={20} strokeWidth={2} />
          </div>
          <h2 className="text-base text-foreground">Database is being set up</h2>
          <p className="mt-2 text-sm text-foreground-light">
            The connection is stored as this app&apos;s <code>DATABASE_URL</code> and takes effect on
            the next deploy. A freshly provisioned Supabase project needs a minute or two to come up.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button asChild variant="primary">
              <Link href={ref ? `/project/${ref}/deployments` : '/'}>Deploy now</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-lg bg-surface-200 text-foreground-lighter">
          <Database size={20} strokeWidth={1.5} />
        </div>
        <h2 className="text-base text-foreground">This app has no database yet</h2>
        <p className="mt-2 text-sm text-foreground-light">
          The Table editor, SQL editor and Database tools work once this app has a database. Provision
          a dedicated one billed to your workspace, or connect a database you already have.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <TaskclanProvisionDatabase onProvisioned={() => setProvisioned(true)} />
          <Button asChild variant="default">
            <Link href={ref ? `/project/${ref}/deployments` : '/'}>Deployments</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
