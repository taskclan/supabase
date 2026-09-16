/**
 * "Set up a database" for an app that has none.
 *
 * Two ways to get an app a database, both served by Cloud's databases API
 * (via /api/taskclan/{ref}/databases):
 *
 *  - Managed: provision a dedicated project (Supabase and/or Neon, whichever the
 *    workspace has configured) at a size tier, billed monthly from the org
 *    wallet. The tiers and prices come from the server so the dialog cannot
 *    drift from what provisioning actually charges.
 *  - Bring your own: paste a Postgres connection string and Cloud stores it as
 *    the app's DATABASE_URL secret.
 *
 * On success the connection is injected on the app's next deploy; this dialog
 * just kicks it off and calls onProvisioned so the surrounding screen can move
 * off its "no database" state.
 */
import { useParams } from 'common'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
  RadioGroupStacked,
  RadioGroupStackedItem,
} from 'ui'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface Plan {
  id: string
  label: string
  blurb?: string
  priceCredits: number
  minCu?: number
  maxCu?: number
}

interface DbInfo {
  supabasePlans?: Plan[]
  plans?: Plan[]
  managedPostgresProviders?: string[]
  supabaseOAuth?: boolean
}

const BYO = 'byo'
const OWN_SUPABASE = 'supabase-oauth'

/** 1 credit = $0.001, so credits/1000 = dollars/month. */
const price = (credits: number) => (credits === 0 ? 'Free' : `$${Math.round(credits / 1000)}/mo`)

interface Option {
  value: string // "supabase:starter" | "neon:standard" | "byo"
  provider: string
  title: string
  blurb: string
  price: string
}

export function TaskclanProvisionDatabase({ onProvisioned }: { onProvisioned?: () => void }) {
  const { ref } = useParams()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<DbInfo | null>(null)
  const [choice, setChoice] = useState('')
  const [name, setName] = useState('')
  const [byoUrl, setByoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !ref) return
    setInfo(null)
    setError(null)
    taskclanFetch(`/api/taskclan/${ref}/databases`)
      .then((r) => r.json())
      .then((b) => setInfo(b as DbInfo))
      .catch(() => setInfo({}))
  }, [open, ref])

  const options = useMemo<Option[]>(() => {
    const out: Option[] = []
    const provs = info?.managedPostgresProviders ?? []
    // Supabase first — a dedicated Supabase project is the headline option.
    if (provs.includes('supabase')) {
      for (const p of info?.supabasePlans ?? []) {
        out.push({
          value: `supabase:${p.id}`,
          provider: 'supabase',
          title: `Supabase · ${p.label}`,
          blurb: p.blurb ?? 'Dedicated Supabase project',
          price: price(p.priceCredits),
        })
      }
    }
    if (provs.includes('neon')) {
      for (const p of info?.plans ?? []) {
        out.push({
          value: `neon:${p.id}`,
          provider: 'neon',
          title: `Neon · ${p.label}`,
          blurb:
            p.blurb ??
            (p.minCu != null ? `${p.minCu}–${p.maxCu} compute units` : 'Managed Postgres'),
          price: price(p.priceCredits),
        })
      }
    }
    if (info?.supabaseOAuth) {
      out.push({
        value: OWN_SUPABASE,
        provider: OWN_SUPABASE,
        title: 'Your own Supabase (one-click)',
        blurb: 'Authorize your Supabase account — a dedicated project is created in your org',
        price: '$3/mo service fee',
      })
    }
    out.push({
      value: BYO,
      provider: BYO,
      title: 'Bring your own',
      blurb: 'Paste a Postgres connection string',
      price: 'Free',
    })
    return out
  }, [info])

  // Default to the first managed tier once options load.
  useEffect(() => {
    if (!choice && options.length) setChoice(options[0].value)
  }, [options, choice])

  const isByo = choice === BYO
  const loading = open && info === null

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (choice === OWN_SUPABASE) {
        // One-click: mint the authorize URL server-side, then hand the browser
        // to Supabase. The engine callback provisions and returns here.
        const res = await taskclanFetch(`/api/taskclan/${ref}/provision-supabase-oauth`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            plan: 'starter',
            name: name.trim() || undefined,
            returnUrl: window.location.href,
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || !body.url) {
          setError(body.error || 'Could not start the Supabase connection.')
          setBusy(false)
          return
        }
        window.location.href = body.url as string
        return
      }
      let payload: Record<string, unknown>
      if (isByo) {
        if (!byoUrl.trim()) {
          setError('Paste a connection string, or pick a managed plan.')
          setBusy(false)
          return
        }
        payload = { url: byoUrl.trim(), name: name.trim() || undefined }
      } else {
        const [provider, plan] = choice.split(':')
        payload = { action: 'provision', provider, plan, name: name.trim() || undefined }
      }
      const r = await taskclanFetch(`/api/taskclan/${ref}/databases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(body.error || 'Could not set up the database.')
        setBusy(false)
        return
      }
      setBusy(false)
      setOpen(false)
      onProvisioned?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">Set up a database</Button>
      </DialogTrigger>
      <DialogContent size="large">
        <DialogHeader>
          <DialogTitle>Set up a database for this app</DialogTitle>
          <DialogDescription>
            Provision a dedicated database billed to your workspace, or connect one you already
            have.
          </DialogDescription>
        </DialogHeader>

        <DialogSection className="flex flex-col gap-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-foreground-light">
              <Loader2 className="animate-spin" size={16} /> Loading options…
            </div>
          ) : (
            <>
              <RadioGroupStacked value={choice} onValueChange={setChoice}>
                {options.map((o) => (
                  <RadioGroupStackedItem
                    key={o.value}
                    id={`db-${o.value}`}
                    value={o.value}
                    label=""
                    className="rounded-lg text-left"
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{o.title}</p>
                        <p className="text-xs text-foreground-light">{o.blurb}</p>
                      </div>
                      <span className="shrink-0 text-sm text-foreground-light">{o.price}</span>
                    </div>
                  </RadioGroupStackedItem>
                ))}
              </RadioGroupStacked>

              {isByo ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tc-byo-url" className="text-xs text-foreground-light">
                    Connection string
                  </label>
                  <Input
                    id="tc-byo-url"
                    value={byoUrl}
                    onChange={(e) => setByoUrl(e.target.value)}
                    placeholder="postgresql://user:password@host:5432/dbname"
                    autoComplete="off"
                  />
                  <p className="text-xs text-foreground-lighter">
                    Stored as the app&apos;s DATABASE_URL secret and injected on the next deploy.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-foreground-lighter">
                  A dedicated project is created and its connection string is stored as this
                  app&apos;s DATABASE_URL. A Supabase project takes ~1–2 minutes to come up. The
                  first month is charged now; you can detach it later.
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="tc-db-name" className="text-xs text-foreground-light">
                  Name <span className="text-foreground-lighter">(optional)</span>
                </label>
                <Input
                  id="tc-db-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Primary database"
                  autoComplete="off"
                />
              </div>

              {error && <p className="text-sm text-destructive-600">{error}</p>}
            </>
          )}
        </DialogSection>

        <DialogSectionSeparator />
        <DialogFooter>
          <Button type="button" variant="default" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={busy}
            disabled={busy || loading}
            onClick={submit}
          >
            {choice === OWN_SUPABASE
              ? 'Connect Supabase'
              : isByo
                ? 'Connect database'
                : 'Provision database'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
