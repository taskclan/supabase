import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, Input } from 'ui'
import { useParams } from 'common'

import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import OrganizationLayout from '@/components/layouts/OrganizationLayout'
import { OrganizationSettingsLayout } from '@/components/layouts/ProjectLayout/OrganizationSettingsLayout'
import {
  REGISTRANT_FIELDS,
  addressLine,
  cardLabel,
  chargeCard,
  ownerLine,
  priceLine,
  purchaseMessage,
  registrantFields,
  searchTerm,
  usd,
  type DomainQuote,
  type RegistrantFields,
} from '@/lib/taskclan/buyDomain'
import {
  useBuyDomainMutation,
  useDomainAppsQuery,
  useDomainSearchQuery,
  usePaymentMethodsQuery,
  useRegistrantQuery,
  useRegistrantUpdateMutation,
} from '@/data/taskclan-domains/domains'
import type { NextPageWithLayout } from '@/types'

type Step = 'find' | 'owner' | 'review' | 'done'

const OrgDomains: NextPageWithLayout = () => {
  const { slug } = useParams()
  const [step, setStep] = useState<Step>('find')

  // Find
  const [term, setTerm] = useState('')
  const [submitted, setSubmitted] = useState('')
  const search = useDomainSearchQuery(slug, submitted, submitted.length > 0)
  const [chosen, setChosen] = useState<DomainQuote | null>(null)

  // Owner
  const registrant = useRegistrantQuery(slug, step === 'owner' || step === 'review')
  const [owner, setOwner] = useState<RegistrantFields>(registrantFields())
  const [ownerLoaded, setOwnerLoaded] = useState(false)
  const [editingOwner, setEditingOwner] = useState(true)
  const [missing, setMissing] = useState<string[]>([])
  const saveOwner = useRegistrantUpdateMutation(slug, {
    onSuccess: (data) => {
      setOwner(registrantFields(data.registrant))
      setEditingOwner(false)
      setMissing([])
      setStep('review')
    },
    onError: (e) => {
      setMissing(e.missing ?? [])
      toast.error(e.missing?.length ? 'Fill in the highlighted fields.' : e.message)
    },
  })

  // Review
  const apps = useDomainAppsQuery(slug, step === 'review')
  const [siteId, setSiteId] = useState('')
  const cards = usePaymentMethodsQuery(slug, step === 'review')
  const defaultCard = useMemo(() => (cards.data ? chargeCard(cards.data.cards) : null), [cards.data])
  const [outcome, setOutcome] = useState<ReturnType<typeof purchaseMessage> | null>(null)
  const buy = useBuyDomainMutation(slug, {
    onSuccess: (res) => {
      const appName = apps.data?.find((a) => a.id === siteId)?.name ?? 'your app'
      const msg = purchaseMessage(chosen?.name ?? 'the domain', appName, res)
      if (msg.tone === 'error') return toast.error(msg.text)
      setOutcome(msg)
      setStep('done')
    },
    onError: (e) => toast.error(e.message),
  })

  // When the registrant loads, seed the form and skip it if it's already complete.
  if (registrant.data && !ownerLoaded) {
    setOwner(registrantFields(registrant.data.registrant))
    setEditingOwner(!registrant.data.registrant.complete)
    setOwnerLoaded(true)
  }
  // Default the app selection to the first app once they load.
  if (apps.data && apps.data.length > 0 && !siteId) setSiteId(apps.data[0].id)

  const runSearch = () => {
    const q = searchTerm(term)
    if (q) setSubmitted(q)
  }
  const reset = () => {
    setStep('find')
    setChosen(null)
    setOutcome(null)
    setMissing([])
  }

  return (
    <div className="1xl:px-28 mx-auto flex flex-col gap-y-8 px-5 py-6 lg:px-16 xl:px-24 2xl:px-32">
      <div>
        <h3 className="text-xl text-foreground">Domains</h3>
        <p className="text-sm text-foreground-light">
          Buy a domain for your company and connect it to an app. It is registered to you, renews every year, and its
          certificate is issued automatically.
        </p>
      </div>

      <div className="rounded-md border border-default bg-surface-100">
        {/* Stepper */}
        {step !== 'done' && (
          <div className="flex items-center gap-2 border-b border-default px-5 py-3 text-xs">
            {(['find', 'owner', 'review'] as const).map((s, i) => (
              <span
                key={s}
                className={`rounded-full px-2 py-0.5 font-medium capitalize ${
                  step === s ? 'bg-brand-400 text-brand-600' : 'text-foreground-lighter'
                }`}
              >
                {i + 1} {s}
              </span>
            ))}
          </div>
        )}

        <div className="p-5">
          {step === 'find' && (
            <div className="flex flex-col gap-y-4">
              <div className="flex gap-x-2">
                <Input
                  className="w-full"
                  placeholder="yourcompany.com"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSearch()
                  }}
                />
                <Button onClick={runSearch} loading={search.isFetching} disabled={!searchTerm(term)}>
                  Search
                </Button>
              </div>
              {search.isError && <p className="text-sm text-destructive">Could not search right now. Try again.</p>}
              {search.data && (
                <div className="divide-y divide-border rounded-md border border-default">
                  {search.data.domains.length === 0 ? (
                    <p className="p-3 text-sm text-foreground-light">Nothing matched. Try another name.</p>
                  ) : (
                    search.data.domains.map((d) => (
                      <div key={d.name} className="flex items-center gap-3 p-3">
                        <span
                          className={`flex-1 truncate font-mono text-sm ${
                            d.available ? 'text-foreground' : 'text-foreground-lighter'
                          }`}
                        >
                          {d.name}
                        </span>
                        {d.available && d.priceUsd != null ? (
                          <span className="whitespace-nowrap text-sm">
                            {usd(d.priceUsd)}
                            <span className="text-foreground-light"> / year</span>
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-xs text-foreground-lighter">{d.reason || 'Taken'}</span>
                        )}
                        <Button
                          variant="default"
                          disabled={!d.available || d.priceUsd == null}
                          onClick={() => {
                            setChosen(d)
                            setStep('owner')
                          }}
                        >
                          Choose
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
              {search.data?.note && <p className="text-xs text-foreground-lighter">{search.data.note}</p>}
            </div>
          )}

          {step === 'owner' && chosen && (
            <div className="flex flex-col gap-y-4">
              <p className="text-sm text-foreground-light">
                Who owns <span className="font-mono text-foreground">{chosen.name}</span>? The registrant is the domain's
                legal owner — use your company's details. Saved for this workspace.
              </p>
              {registrant.isLoading ? (
                <p className="text-sm text-foreground-light">Loading…</p>
              ) : !editingOwner ? (
                <div className="flex items-start justify-between gap-3 rounded-md border border-default p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{ownerLine(owner)}</p>
                    <p className="text-sm text-foreground-light">
                      {owner.phone} · {addressLine(owner)}
                    </p>
                  </div>
                  <Button variant="default" onClick={() => setEditingOwner(true)}>
                    Edit
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {REGISTRANT_FIELDS.map((f) => (
                    <div key={f.key} className={f.wide ? 'col-span-2' : ''}>
                      <label className="mb-1 block text-xs text-foreground-light">
                        {f.label}
                        {f.optional ? ' (optional)' : ''}
                      </label>
                      <Input
                        className={`w-full ${missing.includes(f.key) ? 'border-destructive' : ''}`}
                        value={owner[f.key]}
                        placeholder={f.placeholder}
                        onChange={(e) =>
                          setOwner({
                            ...owner,
                            [f.key]: f.key === 'countryCode' ? e.target.value.toUpperCase().slice(0, 2) : e.target.value,
                          })
                        }
                      />
                      {missing.includes(f.key) ? (
                        <p className="mt-1 text-xs text-destructive">Required</p>
                      ) : (
                        f.hint && <p className="mt-1 text-xs text-foreground-lighter">{f.hint}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="default" onClick={reset}>
                  Back
                </Button>
                {!editingOwner ? (
                  <Button onClick={() => setStep('review')}>Continue</Button>
                ) : (
                  <Button loading={saveOwner.isPending} onClick={() => saveOwner.mutate(owner)}>
                    Save and continue
                  </Button>
                )}
              </div>
            </div>
          )}

          {step === 'review' && chosen && (
            <div className="flex flex-col gap-y-4">
              <p className="text-sm text-foreground-light">
                Your card is charged first; if the registry doesn't confirm, the charge is refunded in full.
              </p>
              <dl className="divide-y divide-border rounded-md border border-default text-sm">
                <Row label="Domain">
                  <span className="font-mono">{chosen.name}</span>
                </Row>
                <Row label="Connect to">
                  {apps.isLoading ? (
                    'Loading apps…'
                  ) : (apps.data?.length ?? 0) === 0 ? (
                    <span className="text-foreground-light">No apps yet — create one first.</span>
                  ) : (
                    <select
                      className="rounded-md border border-strong bg-surface-200 px-2 py-1"
                      value={siteId}
                      onChange={(e) => setSiteId(e.target.value)}
                    >
                      {apps.data!.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Row>
                <Row label="Price">
                  <div>
                    <div>{priceLine(chosen)}</div>
                    <div className="text-xs text-foreground-lighter">
                      Renews automatically. Tax is added where it applies; the price is confirmed at checkout.
                    </div>
                  </div>
                </Row>
                <Row label="Owner">
                  <div className="flex items-center gap-2">
                    <span>{ownerLine(owner)}</span>
                    <Button
                      variant="text"
                      onClick={() => {
                        setEditingOwner(true)
                        setStep('owner')
                      }}
                    >
                      Change
                    </Button>
                  </div>
                </Row>
                <Row label="Payment">
                  {cards.isLoading ? (
                    'Checking the card on file…'
                  ) : defaultCard ? (
                    <span>
                      {cardLabel(defaultCard)} <span className="text-foreground-light">(this workspace's default)</span>
                    </span>
                  ) : (
                    <span className="text-warning">
                      No default card. Add one in Billing, then come back.
                    </span>
                  )}
                </Row>
              </dl>
              <div className="flex justify-end gap-2">
                <Button variant="default" onClick={() => setStep('owner')}>
                  Back
                </Button>
                <Button
                  loading={buy.isPending}
                  disabled={!siteId || !defaultCard}
                  onClick={() => buy.mutate({ domain: chosen.name, siteId })}
                >
                  Buy {chosen.name}
                  {chosen.priceUsd != null ? ` · ${usd(chosen.priceUsd)}` : ''}
                </Button>
              </div>
            </div>
          )}

          {step === 'done' && outcome && (
            <div className="flex flex-col gap-y-4">
              <div
                className={`flex items-start gap-3 rounded-md p-4 text-sm ${
                  outcome.tone === 'success' ? 'bg-brand-300 text-brand-600' : 'bg-warning-300 text-warning-600'
                }`}
              >
                {outcome.text}
              </div>
              <div className="flex justify-end">
                <Button onClick={reset}>Buy another</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-4 py-3">
      <dt className="w-24 flex-none text-xs uppercase tracking-wide text-foreground-lighter">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

OrgDomains.getLayout = (page) => (
  <DefaultLayout>
    <OrganizationLayout title="Domains">
      <OrganizationSettingsLayout>{page}</OrganizationSettingsLayout>
    </OrganizationLayout>
  </DefaultLayout>
)

export default OrgDomains
