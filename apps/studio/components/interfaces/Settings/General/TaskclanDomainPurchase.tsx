/**
 * Buy a domain through Taskclan and attach it to this app.
 *
 * Search → (complete the workspace's registrant contact, pre-filled) → pay. The
 * whole thing self-hides when reselling is off: the registrant endpoint 404s, so
 * `available` stays false and the panel renders nothing. All calls go through
 * /api/taskclan/… ; the Cloud key never reaches the browser.
 */
import { useParams } from 'common'
import { Globe, Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Input } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import Panel from '@/components/ui/Panel'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface DomainResult {
  name: string
  available: boolean
  priceUsd: number | null
  renewalPriceUsd: number | null
  currency: string
  reason?: string | null
}
interface Registrant {
  complete?: boolean
  name?: string
  organization?: string
  email?: string
  phone?: string
  street?: string
  city?: string
  state?: string
  postalCode?: string
  countryCode?: string
}

const FIELDS: { key: keyof Registrant; label: string; required: boolean }[] = [
  { key: 'name', label: 'Full name', required: true },
  { key: 'email', label: 'Email', required: true },
  { key: 'phone', label: 'Phone (e.g. +1.5555555555)', required: true },
  { key: 'organization', label: 'Organization (optional)', required: false },
  { key: 'street', label: 'Street', required: true },
  { key: 'city', label: 'City', required: true },
  { key: 'state', label: 'State / region', required: false },
  { key: 'postalCode', label: 'Postal code', required: true },
  { key: 'countryCode', label: 'Country (2-letter code)', required: true },
]

export const TaskclanDomainPurchase = () => {
  const { ref } = useParams()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [registrant, setRegistrant] = useState<Registrant>({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DomainResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [buying, setBuying] = useState<string | null>(null)
  const [showRegistrant, setShowRegistrant] = useState(false)
  const [savingRegistrant, setSavingRegistrant] = useState(false)

  // Availability probe + registrant pre-fill in one call: 404 = feature is off.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch('/api/taskclan/domains/registrant')
        if (!live) return
        if (res.status === 404) return setAvailable(false)
        const body = (await res.json()) as { registrant?: Registrant }
        setAvailable(res.ok)
        if (body.registrant) setRegistrant(body.registrant)
      } catch {
        if (live) setAvailable(false)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const search = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setResults(null)
    try {
      const res = await taskclanFetch(`/api/taskclan/domains/search?q=${encodeURIComponent(q)}`)
      const body = (await res.json()) as { domains?: DomainResult[]; error?: string }
      if (!res.ok) toast.error(body.error ?? 'search failed')
      else setResults(body.domains ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }, [query])

  const saveRegistrant = useCallback(async () => {
    setSavingRegistrant(true)
    try {
      const res = await taskclanFetch('/api/taskclan/domains/registrant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(registrant),
      })
      const body = (await res.json()) as { registrant?: Registrant; error?: string; missing?: string[] }
      if (!res.ok) {
        toast.error(body.error ?? `missing: ${(body.missing ?? []).join(', ')}`)
        return false
      }
      setRegistrant(body.registrant ?? registrant)
      setShowRegistrant(false)
      toast.success('Registrant contact saved')
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setSavingRegistrant(false)
    }
  }, [registrant])

  const buy = useCallback(
    async (domain: string, priceUsd: number | null) => {
      if (!ref) return
      if (!registrant.complete) {
        setShowRegistrant(true)
        toast.message('Add your registrant contact first — it becomes the domain owner.')
        return
      }
      if (!window.confirm(`Register ${domain} for $${priceUsd?.toFixed(2)}? Your card on file will be charged.`)) {
        return
      }
      setBuying(domain)
      try {
        const res = await taskclanFetch(`/api/taskclan/${ref}/domains/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domain }),
        })
        const body = (await res.json()) as { ok?: boolean; status?: string; error?: string }
        if (!res.ok || !body.ok) {
          toast.error(body.error ?? 'registration failed')
          return
        }
        toast.success(
          body.status === 'active'
            ? `${domain} registered and attached 🎉`
            : `${domain} registered — finish attaching it from Custom domains`
        )
        setResults((rs) => rs?.filter((r) => r.name !== domain) ?? null)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setBuying(null)
      }
    },
    [ref, registrant.complete]
  )

  // Hidden until reselling is enabled.
  if (available !== true) return null

  return (
    <Panel
      title={
        <div className="flex items-center gap-2">
          <Globe size={16} /> Buy a domain
        </div>
      }
    >
      <Panel.Content className="flex flex-col gap-4">
        <p className="text-sm text-foreground-light">
          Register a new domain through Taskclan and attach it to this app. You&apos;re the owner;
          renewals are billed to your card on file each year.
        </p>

        <div className="flex gap-2">
          <Input
            className="flex-1"
            placeholder="search a name, e.g. meitier"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
          <Button
            icon={searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            disabled={searching || !query.trim()}
            onClick={() => void search()}
          >
            Search
          </Button>
        </div>

        {showRegistrant && (
          <div className="flex flex-col gap-3 rounded-md border border-default bg-surface-100 p-4">
            <p className="text-sm text-foreground">Registrant contact (the domain owner)</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-xs text-foreground-light">
                  {f.label}
                  <Input
                    size="tiny"
                    value={(registrant[f.key] as string) ?? ''}
                    onChange={(e) => setRegistrant((r) => ({ ...r, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button loading={savingRegistrant} onClick={() => void saveRegistrant()}>
                Save contact
              </Button>
            </div>
          </div>
        )}

        {results && results.length === 0 && (
          <p className="text-sm text-foreground-lighter">No results.</p>
        )}
        {results && results.length > 0 && (
          <div className="overflow-hidden rounded-md border border-default">
            <table className="w-full text-sm">
              <tbody>
                {results.map((r) => (
                  <tr key={r.name} className="border-t border-default first:border-t-0">
                    <td className="px-4 py-3 text-foreground">{r.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground-light">
                      {r.available && r.priceUsd != null ? `$${r.priceUsd.toFixed(2)}/yr` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.available ? (
                        <Button
                          variant="default"
                          loading={buying === r.name}
                          disabled={buying !== null}
                          onClick={() => void buy(r.name, r.priceUsd)}
                        >
                          Buy
                        </Button>
                      ) : (
                        <span className="text-xs text-foreground-lighter">taken</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Admonition type="note" title="Prices are confirmed at checkout" className="mb-0">
          <p className="text-xs">
            Search prices are indicative; the final price is confirmed when you buy. If registration
            fails, your card is refunded automatically.
          </p>
        </Admonition>
      </Panel.Content>
    </Panel>
  )
}
