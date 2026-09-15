/**
 * The Taskclan-native "keys" surface, shared by the Connect sheet's Server tab
 * and the API Keys settings page.
 *
 * Taskclan has no per-app REST endpoint, no per-app API-key service, and no
 * per-app secret/service_role key. An app connects two ways:
 *
 *  - REST via supabase-js: the SHARED project URL + anon key. Public by design
 *    (ships in every app bundle), RLS-governed, and the SAME for all apps — it
 *    is NOT the app-isolation boundary.
 *  - Server-side: the app's own DATABASE_URL — a scoped Postgres role. THIS is
 *    the per-app isolation boundary, and it replaces the shared service_role
 *    key a Supabase-hosted project would hand a server. We never surface the
 *    shared service_role.
 *
 * The connection string carries a real password (the console resolves it
 * server-side, behind the access gate, and the user opted into revealing it).
 * It is masked by default here with a reveal toggle, mirroring how Supabase
 * treats a secret key.
 */
import { useParams } from 'common'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import { ShimmeringLoader } from 'ui-patterns/ShimmeringLoader'

import {
  useTaskclanConnectInfo,
  useTaskclanConnectionPooler,
} from '@/components/interfaces/ConnectSheet/useTaskclanConnection'

function maskPassword(cs: string): string {
  // postgresql://user:PASSWORD@host:port/db -> ...:••••@...
  return cs.replace(/(postgresql:\/\/[^:@/]+:)([^@]+)(@)/, '$1••••••••••••$3')
}

function KeyRow({
  name,
  value,
  copyValue,
  action,
}: {
  name: string
  value: string
  copyValue?: string
  action?: React.ReactNode
}) {
  const onCopy = () => {
    const v = copyValue ?? value
    navigator.clipboard
      .writeText(v)
      .then(() => toast.success(`Copied ${name}`))
      .catch(() => toast.error('Could not copy'))
  }
  return (
    <div className="flex items-center gap-x-2 py-2.5 pl-4 pr-2 font-mono text-sm">
      <span className="shrink-0 text-foreground-lighter">{name}=</span>
      <span className="flex-1 truncate text-foreground" title={value}>
        {value}
      </span>
      <div className="flex items-center gap-x-1">
        {action}
        <Button
          size="tiny"
          variant="text"
          className="px-1.5"
          icon={<Copy strokeWidth={2} />}
          aria-label={`Copy ${name}`}
          onClick={onCopy}
        />
      </div>
    </div>
  )
}

export function TaskclanApiKeys() {
  const { ref } = useParams()
  const info = useTaskclanConnectInfo()
  const pooler = useTaskclanConnectionPooler()
  const [revealed, setRevealed] = useState(false)

  const connection = pooler?.sessionShared ?? ''
  const connectionDisplay = useMemo(
    () => (revealed ? connection : maskPassword(connection)),
    [revealed, connection]
  )

  // info is fetch-based and resolves quickly; pooler is null for an app with no
  // database. Show a loader only while info is still loading.
  if (info === null) return <ShimmeringLoader className="h-40 w-full" />

  const apiUrl = info.apiUrl ?? ''
  const anonKey = info.anonKey ?? ''

  return (
    <div className="flex flex-col gap-y-3">
      <div className="overflow-hidden rounded-lg border bg-surface-75">
        <div className="flex items-center justify-between border-b bg-surface-100 py-2 pl-4 pr-2">
          <span className="font-mono text-xs text-foreground-light">.env</span>
        </div>
        <div className="divide-y">
          <KeyRow name="SUPABASE_URL" value={apiUrl} />
          <KeyRow name="SUPABASE_ANON_KEY" value={anonKey} />
          {connection ? (
            <KeyRow
              name="DATABASE_URL"
              value={connectionDisplay}
              copyValue={connection}
              action={
                <Button
                  size="tiny"
                  variant="text"
                  className="px-1.5"
                  icon={revealed ? <EyeOff strokeWidth={2} /> : <Eye strokeWidth={2} />}
                  aria-label={revealed ? 'Hide connection password' : 'Reveal connection password'}
                  onClick={() => setRevealed((v) => !v)}
                />
              }
            />
          ) : null}
        </div>
      </div>

      <Admonition
        type="default"
        title="How isolation works here"
        description={
          <div className="flex flex-col gap-y-1 text-sm">
            <p>
              <code className="text-code-inline">SUPABASE_ANON_KEY</code> is the shared project&apos;s
              public anon key. It&apos;s the same for every Taskclan app and is governed by row-level
              security &mdash; it is <span className="text-foreground">not</span> per-app isolated.
            </p>
            <p>
              <code className="text-code-inline">DATABASE_URL</code> is this app&apos;s own scoped role
              &mdash; that&apos;s the per-app boundary, and the credential a server should use. There is
              no shared secret/service_role key to hand out.
            </p>
          </div>
        }
      />
      {ref ? (
        <p className="text-sm text-foreground-lighter">
          The connection string is also on the Connect panel&apos;s Direct tab, with pooler options.
        </p>
      ) : null}
    </div>
  )
}
