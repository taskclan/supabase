/**
 * Custom domains for a Taskclan Cloud app.
 *
 * This lived only in the engine console, and as one org-wide page that looped
 * over every site to build its list. Per-project here, which is both the shape
 * Studio already uses and one request instead of N.
 *
 * The screen is mostly about one question: why is my domain not working yet.
 * The engine answers it properly — it re-reads certificate and DCV state from
 * Cloudflare on every load and checks whether each DNS record it asked for has
 * actually resolved — so the job here is to show that rather than a spinner and
 * a status word. In particular the two waiting states are told apart: records
 * still missing (go and add them) versus records in place and the certificate
 * still issuing (wait). Conflating them sends people back to re-check work they
 * have already finished, which is the complaint this kind of screen attracts.
 */
import { useParams } from 'common'
import { Check, Copy, Globe, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Input, copyToClipboard } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import ConfirmationModal from 'ui-patterns/Dialogs/ConfirmationModal'

import Panel from '@/components/ui/Panel'
import {
  domainExplanation,
  domainHealth,
  hostnameError,
  normalizeHostname,
  type CustomDomain,
  type DomainRecord,
} from '@/lib/taskclan/domains'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface DomainsResponse {
  provider?: string
  target?: string
  managed?: { host?: string | null; prettyHost?: string | null }
  domains?: CustomDomain[]
  error?: string
}

const HEALTH_LABEL: Record<string, string> = {
  live: 'Live',
  pending: 'Verifying',
  failed: 'Needs attention',
  redirect: 'Redirect',
}

const RecordRow = ({ record }: { record: DomainRecord }) => {
  const isResolved = (record.state ?? 'unknown') === 'ok'
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 font-mono text-xs text-foreground">{record.type}</td>
      <td className="px-3 py-2 font-mono text-xs text-foreground break-all">{record.name}</td>
      <td className="px-3 py-2 font-mono text-xs text-foreground-light break-all">
        {record.value}
      </td>
      <td className="px-3 py-2 text-right">
        <span
          className={`text-xs ${isResolved ? 'text-brand' : 'text-foreground-lighter'}`}
          title={record.found?.length ? `Found: ${record.found.join(', ')}` : undefined}
        >
          {isResolved ? 'Found' : 'Not found yet'}
        </span>
      </td>
    </tr>
  )
}

export const TaskclanDomains = () => {
  const { ref } = useParams()

  const [data, setData] = useState<DomainsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [input, setInput] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [domainToRemove, setDomainToRemove] = useState<CustomDomain | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = async () => {
    if (!ref) return
    try {
      const res = await taskclanFetch(`/api/taskclan/${ref}/domains`)
      const body = (await res.json().catch(() => ({}))) as DomainsResponse
      if (!res.ok) {
        setLoadError(body?.error || `Could not load domains (${res.status})`)
        setData({ domains: [] })
        return
      }
      setData(body)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setData({ domains: [] })
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])

  const domains = data?.domains ?? []
  const attached = domains.map((d) => d.hostname)
  const inputError = hostnameError(input, attached)
  const normalized = normalizeHostname(input)
  const canAdd = normalized.length > 0 && !inputError && !isAdding

  const handleAdd = async () => {
    setIsAdding(true)
    try {
      const res = await taskclanFetch(`/api/taskclan/${ref}/domains`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: normalized }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The engine refuses with a sentence written for a person — a role that
        // cannot attach domains, a reserved hostname, or Cloudflare's own words
        // about why a bind failed. All of those beat a generic failure.
        toast.error(body?.error || `Could not attach ${normalized} (${res.status})`)
        return
      }
      toast.success(`${normalized} attached. Add the DNS records below to finish.`)
      setInput('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemove = async () => {
    if (!domainToRemove) return
    setIsRemoving(true)
    try {
      const res = await taskclanFetch(`/api/taskclan/${ref}/domains`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: domainToRemove.hostname }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error || `Could not remove the domain (${res.status})`)
        return
      }
      toast.success(`${domainToRemove.hostname} removed`)
      setDomainToRemove(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <>
      <Panel title={<h5>Managed domain</h5>}>
        <Panel.Content className="flex flex-col gap-1">
          {/* A dash while loading would read as "this app has no managed
              domain", which is both untrue and alarming — every app has one. */}
          {data === null && (
            <p className="flex items-center gap-2 text-sm text-foreground-light">
              <Loader2 className="animate-spin" size={14} /> Loading…
            </p>
          )}
          {data !== null && (
            <>
              <p className="font-mono text-sm text-foreground">{data.managed?.host ?? '—'}</p>
              {/* Only when it actually differs. The engine returns both fields
                  and they are frequently the same string; printing it twice
                  looks like two domains. */}
              {!!data.managed?.prettyHost && data.managed.prettyHost !== data.managed.host && (
                <p className="font-mono text-xs text-foreground-light">
                  {data.managed.prettyHost}
                </p>
              )}
              <p className="text-xs text-foreground-lighter">
                Given to every app. It keeps working after you attach your own domain.
              </p>
            </>
          )}
        </Panel.Content>
      </Panel>

      <Panel title={<h5>Add a custom domain</h5>}>
        <Panel.Content className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="tc-domain" className="sr-only">
                Domain
              </label>
              <Input
                id="tc-domain"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="app.yourdomain.com"
              />
              {inputError && <p className="text-xs text-warning">{inputError}</p>}
              {!inputError && normalized.length > 0 && normalized !== input.trim() && (
                // Confirm what will actually be stored. Somebody pasting a full
                // URL should see the hostname it reduces to, not wonder.
                <p className="text-xs text-foreground-lighter">
                  Will attach <span className="font-mono">{normalized}</span>
                </p>
              )}
            </div>
            <Button onClick={handleAdd} loading={isAdding} disabled={!canAdd}>
              Add domain
            </Button>
          </div>
        </Panel.Content>
      </Panel>

      <Panel title={<h5>Custom domains</h5>}>
        <Panel.Content className="flex flex-col gap-4">
          {data === null && (
            <p className="flex items-center gap-2 text-sm text-foreground-light">
              <Loader2 className="animate-spin" size={14} /> Loading…
            </p>
          )}
          {data !== null && loadError && (
            <Admonition type="warning" title="Could not load domains" description={loadError} />
          )}
          {data !== null && !loadError && domains.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Globe size={20} className="text-foreground-lighter" />
              <p className="text-sm text-foreground-light">
                No custom domains yet. Add one above to serve this app from your own hostname.
              </p>
            </div>
          )}

          {data !== null &&
            !loadError &&
            domains.map((d) => {
              const health = domainHealth(d)
              const records = d.records ?? []
              return (
                <div key={d.hostname} className="rounded border border-border">
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-mono text-sm text-foreground">
                        {d.hostname}
                        {health === 'live' && <Check size={13} className="text-brand" />}
                        {health === 'failed' && (
                          <TriangleAlert size={13} className="text-warning" />
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-foreground-light">
                        {HEALTH_LABEL[health]} · {domainExplanation(d)}
                      </p>
                    </div>
                    <Button variant="default" onClick={() => setDomainToRemove(d)}>
                      Remove
                    </Button>
                  </div>

                  {records.length > 0 && (
                    <div className="overflow-x-auto border-t border-border">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-xs text-foreground-lighter">
                            <th className="px-3 py-2 font-normal">Type</th>
                            <th className="px-3 py-2 font-normal">Name</th>
                            <th className="px-3 py-2 font-normal">Value</th>
                            <th className="px-3 py-2 text-right font-normal">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.map((r) => (
                            <RecordRow key={`${r.type}:${r.name}:${r.value}`} record={r} />
                          ))}
                        </tbody>
                      </table>
                      <div className="border-t border-border px-3 py-2">
                        <Button
                          variant="default"
                          icon={
                            copied === d.hostname ? <Check size={13} /> : <Copy size={13} />
                          }
                          onClick={() => {
                            const text = records
                              .map((r) => `${r.type}\t${r.name}\t${r.value}`)
                              .join('\n')
                            copyToClipboard(text, () => setCopied(d.hostname))
                          }}
                        >
                          {copied === d.hostname ? 'Copied' : 'Copy records'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
        </Panel.Content>
      </Panel>

      <ConfirmationModal
        visible={!!domainToRemove}
        loading={isRemoving}
        variant="destructive"
        title={`Remove ${domainToRemove?.hostname ?? 'this domain'}?`}
        confirmLabel="Remove domain"
        alert={{
          title: 'Traffic to this hostname stops reaching the app.',
          description:
            'The DNS records at your provider are not touched, so anyone visiting the hostname will get an error until you remove or repoint them. The managed domain keeps working.',
        }}
        onConfirm={handleRemove}
        onCancel={() => {
          if (!isRemoving) setDomainToRemove(null)
        }}
      />
    </>
  )
}
