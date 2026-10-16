/**
 * Cloud API keys, the credential that drives the Taskclan Cloud API from CI, a
 * script, or an MCP client.
 *
 * This existed only in the engine's console, which this one replaces, so
 * without it a customer who lost a key had nowhere to mint another.
 *
 * Two behaviours are load-bearing and neither is decoration:
 *
 * The plaintext is shown once and then is gone. The engine stores a SHA-256
 * hash and a 14-character prefix, so this really is the only moment the value
 * exists, and the panel says so in those words rather than hinting.
 *
 * Revoking is immediate and irreversible, so the confirmation leads with when
 * the key was last used. "Used 20 minutes ago" and "never used" call for
 * opposite decisions, and the engine already records which it is.
 *
 * Not ported from the engine's version: `window.confirm` (this console uses
 * ConfirmationModal) and hiding revoked keys (that one was revoked is worth
 * keeping).
 *
 * One thing the engine's page gets right and is easy to get wrong here: these
 * keys really do drive the CLI. `taskclan login` runs a device flow that mints
 * a key labelled with the machine's hostname and writes it to `~/.netrc`, so
 * the rows reading "taskclan CLI (some-laptop)" are live login credentials, not
 * leftovers. Revoking one signs that machine out of `git push`, which is why
 * the confirmation says so.
 */
import { useParams } from 'common'
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Input, copyToClipboard } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import ConfirmationModal from 'ui-patterns/Dialogs/ConfirmationModal'

import Panel from '@/components/ui/Panel'
import {
  describeLastUsed,
  keyLabel,
  partitionKeys,
  revokeWarning,
  type CloudApiKey,
} from '@/lib/taskclan/apiKeys'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

/** The one endpoint that is stable regardless of which host serves the console. */
const CLOUD_API_ORIGIN = 'https://engine.taskclan.com'

export const TaskclanApiKeys = () => {
  const { slug } = useParams()

  const [keys, setKeys] = useState<CloudApiKey[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  // The plaintext, held in memory only for as long as this panel is mounted.
  const [freshKey, setFreshKey] = useState<string | null>(null)
  const [hasCopied, setHasCopied] = useState(false)

  const [keyToRevoke, setKeyToRevoke] = useState<CloudApiKey | null>(null)
  const [isRevoking, setIsRevoking] = useState(false)

  const load = async () => {
    try {
      const res = await taskclanFetch('/api/taskclan/keys')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(body?.error || `Could not load API keys (${res.status})`)
        setKeys([])
        return
      }
      setKeys(Array.isArray(body.keys) ? (body.keys as CloudApiKey[]) : [])
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setKeys([])
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      const res = await taskclanFetch('/api/taskclan/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.key) {
        toast.error(body?.error || `Could not create the key (${res.status})`)
        return
      }
      setFreshKey(body.key as string)
      setHasCopied(false)
      setName('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setIsCreating(false)
    }
  }

  const handleRevoke = async () => {
    if (!keyToRevoke) return
    setIsRevoking(true)
    try {
      const res = await taskclanFetch(`/api/taskclan/keys/${keyToRevoke.id}/revoke`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error || `Could not revoke the key (${res.status})`)
        return
      }
      toast.success(`${keyLabel(keyToRevoke)} has been revoked`)
      setKeyToRevoke(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setIsRevoking(false)
    }
  }

  const { active, revoked } = partitionKeys(keys ?? [])

  return (
    <>
      <Panel title={<h5>Create an API key</h5>}>
        <Panel.Content className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="tc-key-name" className="text-sm text-foreground">
                Name
              </label>
              <Input
                id="tc-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. CI, laptop, mcp"
              />
            </div>
            <Button onClick={handleCreate} loading={isCreating} disabled={isCreating}>
              Create key
            </Button>
          </div>

          {freshKey && (
            <Admonition
              type="warning"
              title="Copy this key now. It will not be shown again."
              description={
                <div className="mt-2 flex flex-col gap-2">
                  <code className="block break-all rounded bg-surface-200 px-3 py-2 font-mono text-xs text-foreground">
                    {freshKey}
                  </code>
                  <div>
                    <Button
                      variant="default"
                      icon={hasCopied ? <Check size={14} /> : <Copy size={14} />}
                      onClick={() => {
                        copyToClipboard(freshKey, () => setHasCopied(true))
                      }}
                    >
                      {hasCopied ? 'Copied' : 'Copy key'}
                    </Button>
                  </div>
                </div>
              }
            />
          )}
        </Panel.Content>
      </Panel>

      <Panel title={<h5>Active keys</h5>}>
        <Panel.Content>
          {keys === null && (
            <p className="flex items-center gap-2 text-sm text-foreground-light">
              <Loader2 className="animate-spin" size={14} /> Loading…
            </p>
          )}
          {keys !== null && loadError && (
            <Admonition type="warning" title="Could not load API keys" description={loadError} />
          )}
          {keys !== null && !loadError && active.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <KeyRound size={20} className="text-foreground-lighter" />
              <p className="text-sm text-foreground-light">
                No API keys yet. Create one to call the Cloud API from CI or an MCP client.
              </p>
            </div>
          )}
          {keys !== null && !loadError && active.length > 0 && (
            <div className="divide-y divide-border">
              {active.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{keyLabel(k)}</p>
                    <p className="font-mono text-xs text-foreground-lighter">{k.keyPrefix}…</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-foreground-light">
                      {describeLastUsed(k.lastUsedAt)}
                    </span>
                    <Button variant="default" onClick={() => setKeyToRevoke(k)}>
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel.Content>
      </Panel>

      {revoked.length > 0 && (
        <Panel title={<h5>Revoked keys</h5>}>
          <Panel.Content className="divide-y divide-border">
            {revoked.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground-light line-through">
                    {keyLabel(k)}
                  </p>
                  <p className="font-mono text-xs text-foreground-lighter">{k.keyPrefix}…</p>
                </div>
                <span className="text-xs text-foreground-lighter">
                  Revoked {new Date(k.revokedAt!).toLocaleDateString()}
                </span>
              </div>
            ))}
          </Panel.Content>
        </Panel>
      )}

      <Panel title={<h5>Using a key</h5>}>
        <Panel.Content className="flex flex-col gap-4 text-sm text-foreground-light">
          <div className="flex flex-col gap-1.5">
            <p className="text-foreground">Call the Cloud API</p>
            <pre className="overflow-x-auto rounded bg-surface-200 px-3 py-2 font-mono text-xs text-foreground">
              {`curl ${CLOUD_API_ORIGIN}/api/cloud/v1/sites \\
  -H "Authorization: Bearer $TASKCLAN_API_KEY"`}
            </pre>
            <p className="text-xs">
              The same key works on every <code className="font-mono">/api/cloud/v1</code> endpoint:
              sites, deployments, domains, environment and credits.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-foreground">Connect an MCP client</p>
            <pre className="overflow-x-auto rounded bg-surface-200 px-3 py-2 font-mono text-xs text-foreground">
              {`${CLOUD_API_ORIGIN}/api/cloud/mcp
Authorization: Bearer $TASKCLAN_API_KEY`}
            </pre>
          </div>

          <Admonition
            type="default"
            title="The CLI creates one of these too"
            description={
              <span>
                <code className="font-mono">taskclan login</code> mints a key named after your
                machine and stores it in <code className="font-mono">~/.netrc</code>, which is what
                makes <code className="font-mono">git push taskclan main</code> work. Those appear
                in the list above like any other key, so revoking one signs that machine out until
                you run <code className="font-mono">taskclan login</code> again.
              </span>
            }
          />

          <p className="text-xs">
            Treat keys like passwords. Revoke one immediately if it leaks.
          </p>
        </Panel.Content>
      </Panel>

      <ConfirmationModal
        visible={!!keyToRevoke}
        loading={isRevoking}
        variant="destructive"
        title={`Revoke ${keyToRevoke ? keyLabel(keyToRevoke) : 'this key'}?`}
        confirmLabel="Revoke key"
        alert={{
          title: 'This cannot be undone.',
          description: keyToRevoke ? revokeWarning(keyToRevoke) : '',
        }}
        onConfirm={handleRevoke}
        onCancel={() => {
          if (!isRevoking) setKeyToRevoke(null)
        }}
      />
    </>
  )
}
