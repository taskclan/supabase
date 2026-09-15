/**
 * Per-app environment variables & secrets for the Taskclan console.
 *
 * The engine already exposes a per-site env API (list with masking, upsert,
 * delete, gated on write/read-secret capability); this is the dashboard for it,
 * so operators stop reaching for curl. Values reach a container at build time,
 * so a variable written since the last deploy is stored but not yet live — the
 * screen says which, and every mutation notes it applies on the next deploy.
 */
import { useParams } from 'common'
import { Eye, EyeOff, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogSection,
  DialogSectionSeparator,
  DialogTitle,
  DialogTrigger,
  Input,
  Switch,
} from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

interface EnvVar {
  key: string
  value: string
  scope: string
  isSecret: boolean
}
interface EnvResp {
  env?: EnvVar[]
  canWrite?: boolean
  canReveal?: boolean
  pending?: string[]
  error?: string
}

export function TaskclanSecrets() {
  const { ref } = useParams()
  const [data, setData] = useState<EnvResp | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add dialog
  const [addOpen, setAddOpen] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newSecret, setNewSecret] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const load = useCallback(
    async (reveal: boolean) => {
      if (!ref) return
      setLoading(true)
      setError(null)
      try {
        const r = await fetch(`/api/taskclan/${ref}/env${reveal ? '?reveal=1' : ''}`)
        const body = (await r.json()) as EnvResp
        if (!r.ok) {
          setError(body.error || 'Could not load environment variables')
          setData({ env: [] })
        } else {
          setData(body)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setData({ env: [] })
      } finally {
        setLoading(false)
      }
    },
    [ref]
  )

  useEffect(() => {
    load(false)
  }, [load])

  const toggleReveal = async () => {
    const next = !revealed
    setRevealed(next)
    await load(next)
  }

  const save = async () => {
    const key = newKey.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      setAddError('Key must be letters, digits and underscores, starting with a letter or underscore.')
      return
    }
    setSaving(true)
    setAddError(null)
    try {
      const r = await fetch(`/api/taskclan/${ref}/env`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, value: newValue, isSecret: newSecret, scope: 'production' }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setAddError(body.error || 'Could not save')
        setSaving(false)
        return
      }
      toast.success(`Saved ${key} — applies on the next deploy`)
      setAddOpen(false)
      setNewKey('')
      setNewValue('')
      setNewSecret(true)
      setSaving(false)
      load(revealed)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const remove = async (key: string, scope: string) => {
    if (!window.confirm(`Delete ${key}? It stays live until the next deploy.`)) return
    const r = await fetch(`/api/taskclan/${ref}/env`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, scope }),
    })
    if (r.ok) {
      toast.success(`Deleted ${key}`)
      load(revealed)
    } else {
      const b = await r.json().catch(() => ({}))
      toast.error(b.error || 'Delete failed')
    }
  }

  const env = data?.env ?? []
  const canWrite = data?.canWrite ?? false
  const canReveal = data?.canReveal ?? false
  const pending = new Set(data?.pending ?? [])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base text-foreground">Secrets & environment variables</h3>
          <p className="text-sm text-foreground-light">
            Injected into this app&apos;s container. Changes apply on the next deploy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canReveal && env.length > 0 && (
            <Button
              variant="default"
              icon={revealed ? <EyeOff /> : <Eye />}
              onClick={toggleReveal}
            >
              {revealed ? 'Hide values' : 'Reveal values'}
            </Button>
          )}
          {canWrite && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button variant="primary" icon={<Plus />}>
                  Add variable
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add environment variable</DialogTitle>
                  <DialogDescription>
                    Stored on this app and injected on the next deploy. Adding a key that already
                    exists overwrites it.
                  </DialogDescription>
                </DialogHeader>
                <DialogSection className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="tc-env-key" className="text-xs text-foreground-light">
                      Key
                    </label>
                    <Input
                      id="tc-env-key"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                      placeholder="SUPABASE_OAUTH_CLIENT_ID"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="tc-env-value" className="text-xs text-foreground-light">
                      Value
                    </label>
                    <Input
                      id="tc-env-value"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder="value"
                      autoComplete="off"
                      type={newSecret ? 'password' : 'text'}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-foreground">Secret</p>
                      <p className="text-xs text-foreground-light">
                        Masked in the dashboard; revealing is limited to owners.
                      </p>
                    </div>
                    <Switch checked={newSecret} onCheckedChange={setNewSecret} />
                  </div>
                  {addError && <p className="text-sm text-destructive-600">{addError}</p>}
                </DialogSection>
                <DialogSectionSeparator />
                <DialogFooter>
                  <Button variant="default" disabled={saving} onClick={() => setAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" loading={saving} disabled={saving} onClick={save}>
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {error && <Admonition type="warning" title="Could not load environment variables" description={error} />}

      {loading && !data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-foreground-light">
          <Loader2 className="animate-spin" size={16} /> Loading…
        </div>
      ) : env.length === 0 ? (
        <div className="rounded-lg border border-dashed border-default p-8 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-surface-200 text-foreground-lighter">
            <KeyRound size={18} strokeWidth={1.5} />
          </div>
          <p className="text-sm text-foreground">No environment variables yet</p>
          <p className="mt-1 text-sm text-foreground-light">
            {canWrite ? 'Add one to inject it into this app on the next deploy.' : 'This app has no environment variables.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-default">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-default bg-surface-100 text-left text-xs text-foreground-lighter">
                <th className="px-4 py-2 font-normal">Key</th>
                <th className="px-4 py-2 font-normal">Value</th>
                {canWrite && <th className="w-10 px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {env.map((v) => (
                <tr key={`${v.key}:${v.scope}`} className="align-top">
                  <td className="px-4 py-2.5 font-mono text-foreground">
                    <div className="flex items-center gap-2">
                      {v.key}
                      {v.isSecret && (
                        <span className="rounded bg-surface-200 px-1.5 py-0.5 text-[10px] uppercase text-foreground-lighter">
                          secret
                        </span>
                      )}
                      {pending.has(v.key) && (
                        <span className="rounded bg-warning-200 px-1.5 py-0.5 text-[10px] uppercase text-warning-600">
                          pending deploy
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-0 truncate px-4 py-2.5 font-mono text-foreground-light" title={v.value}>
                    {v.value}
                  </td>
                  {canWrite && (
                    <td className="px-2 py-2">
                      <Button
                        variant="text"
                        size="tiny"
                        className="px-1.5"
                        icon={<Trash2 />}
                        aria-label={`Delete ${v.key}`}
                        onClick={() => remove(v.key, v.scope)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
