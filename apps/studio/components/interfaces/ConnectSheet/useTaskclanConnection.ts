/**
 * The app's real connection string for the Connect panel, from Taskclan Cloud.
 *
 * Studio's own pooler builder reads Supabase supavisor/pgbouncer config that
 * self-hosted Taskclan does not have, so the Connect panel's strings come out
 * blank. This fetches the app's actual scoped connection (server-resolved by
 * ref, behind the access gate) and shapes it into the ConnectionStringPooler
 * the panel already knows how to render.
 */
import { useParams } from 'common'
import { useEffect, useState } from 'react'

import type { ConnectionStringPooler } from './Connect.types'

interface TaskclanConnection {
  configured: boolean
  transaction?: string
  session?: string
}

/**
 * The pooler bag, or null while loading / when the app has no database.
 *
 * `direct` is set to the session URL: a pooled scoped role has no separate
 * direct host, and a working session-mode string is a truer "direct" than a
 * blank field. transaction/session are the real 6543/5432 variants.
 */
export function useTaskclanConnectionPooler(): ConnectionStringPooler | null {
  const { ref } = useParams()
  const [data, setData] = useState<TaskclanConnection | null>(null)

  useEffect(() => {
    if (!ref) return
    let live = true
    ;(async () => {
      try {
        const res = await fetch(`/api/taskclan/${ref}/connection-string`)
        const body = await res.json()
        if (live) setData(res.ok ? body : { configured: false })
      } catch {
        if (live) setData({ configured: false })
      }
    })()
    return () => {
      live = false
    }
  }, [ref])

  if (!data || !data.configured || !data.transaction) return null

  return {
    transactionShared: data.transaction,
    sessionShared: data.session ?? data.transaction,
    direct: data.session ?? data.transaction,
    transactionDedicated: undefined,
    sessionDedicated: undefined,
    ipv4SupportedForDedicatedPooler: false,
  }
}
