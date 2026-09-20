/**
 * Taskclan Cloud's "Create a new project" form (shown when !IS_PLATFORM).
 *
 * The stock ProjectCreationForm is shaped for provisioning a Supabase database
 * project on the hosted platform (Stripe setup intents, org subscriptions, free
 * -project limits, Postgres versions, HA/read replicas) — none of which apply
 * here. In this console a "project" is a Taskclan Cloud app (a site), which is
 * exactly what the project list already shows. So this form creates an app:
 *
 *   - Name + type (web service or static site).
 *   - Source: start empty ("just locally", deploy later) OR import a GitHub repo
 *     (the engine creates the site, links the repo and kicks off a build).
 *   - Database (optional): none, a managed database (Supabase/Neon, wallet-billed),
 *     your own Supabase via one-click OAuth ($3/mo service fee), or your own
 *     connection string — all attached to the new app after it is created.
 *
 * Orchestrated client-side so each step gives its own feedback and a later
 * failure (e.g. the database) does not lose the app that was already created.
 */
import { useParams } from 'common'
import { Check, CreditCard, Github, Loader2, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Button,
  Input,
  RadioGroupStacked,
  RadioGroupStackedItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import { TaskclanAddCardModal } from '@/components/interfaces/Organization/BillingSettings/TaskclanAddCardModal'
import Panel from '@/components/ui/Panel'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import {
  availabilityMessage,
  clampMaxInstances,
  defaultInstanceId,
  describeCost,
  describeInstance,
  type InstanceCatalog,
  type NameCheck,
} from '@/lib/taskclan/instances'

interface Plan {
  id: string
  label: string
  blurb?: string
  priceCredits: number
}
interface DbInfo {
  supabasePlans?: Plan[]
  plans?: Plan[]
  managedPostgresProviders?: string[]
  supabaseOAuth?: boolean
}
interface Repo {
  fullName: string
  defaultBranch: string
  private: boolean
  installationId: number
  owner: string
}

// Non-managed database choices, matching the per-app "Set up a database" dialog.
const BYO = 'byo'
const OWN_SUPABASE = 'supabase-oauth'

/** 1 credit = $0.001, so credits/1000 = dollars/month. */
const price = (credits: number) => (credits === 0 ? 'Free' : `$${Math.round(credits / 1000)}/mo`)

export const TaskclanProjectCreationForm = () => {
  const router = useRouter()
  const { slug } = useParams()

  const [name, setName] = useState('')
  const [type, setType] = useState<'service' | 'static'>('service')
  const [source, setSource] = useState<'empty' | 'github'>('empty')
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('')

  const [dbMode, setDbMode] = useState<'none' | 'add'>('none')
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)
  const [dbChoice, setDbChoice] = useState('') // "supabase:starter" | "neon:standard" | "byo" | "supabase-oauth"
  const [byoUrl, setByoUrl] = useState('')

  // Container sizing. Only web services have a container, and the size is only
  // applied by the deploy that follows creation — so this is asked for (and
  // sent) exactly when there is a deploy to apply it to.
  const [instances, setInstances] = useState<InstanceCatalog | null>(null)
  const [instanceType, setInstanceType] = useState('')
  const [autoscale, setAutoscale] = useState(false)
  const [maxInstances, setMaxInstances] = useState(3)

  // A card on file. A web service runs a paid container, so one is required to
  // create it; adding it enrols the org in pay-as-you-go and unlocks every size.
  // null = not yet known (or the caller is not an owner and cannot manage cards)
  // — treated as "do not hard-gate", since the engine still enforces at deploy.
  const [hasCard, setHasCard] = useState<boolean | null>(null)
  const [showAddCard, setShowAddCard] = useState(false)

  // Subdomain availability, answered by the engine rather than guessed at here.
  const [nameCheck, setNameCheck] = useState<NameCheck | null>(null)
  const [checkingName, setCheckingName] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Managed database catalogue (providers + tiers). Fetched once — it is the
  // same for every app in the org.
  useEffect(() => {
    taskclanFetch('/api/taskclan/db-plans')
      .then((r) => r.json())
      .then((b) => setDbInfo(b as DbInfo))
      .catch(() => setDbInfo({}))
  }, [])

  // The size ladder, with `locked` and the autoscaling ceiling scoped to this
  // caller — a card on file (postpaid) unlocks the whole ladder. Reloadable so
  // adding a card re-unlocks the picker without a page refresh.
  const reloadInstances = useCallback(async () => {
    try {
      const r = await taskclanFetch('/api/taskclan/instances')
      if (!r.ok) return
      const b = await r.json()
      if (!b || !Array.isArray(b.types)) return
      const catalog = b as InstanceCatalog
      setInstances(catalog)
      // Keep the chosen size if it is still offered and unlocked; otherwise fall
      // back to the catalogue's recommended default.
      setInstanceType((prev) =>
        catalog.types.some((t) => t.id === prev && !t.locked) ? prev : defaultInstanceId(catalog)
      )
      setMaxInstances((prev) => (prev >= 2 ? prev : catalog.autoscale.suggested))
    } catch {
      // Leave whatever we had; the engine's deploy gate is the backstop.
    }
  }, [])
  useEffect(() => {
    void reloadInstances()
  }, [reloadInstances])

  // Whether the org already has a card on file (and is therefore pay-as-you-go).
  // Reloaded after a card is added so the gate clears in place.
  const reloadCard = useCallback(async () => {
    try {
      const r = await taskclanFetch('/api/taskclan/billing/payment-methods')
      if (!r.ok) {
        setHasCard(null)
        return
      }
      const b = await r.json()
      setHasCard(typeof b?.hasCard === 'boolean' ? b.hasCard : null)
    } catch {
      setHasCard(null)
    }
  }, [])
  useEffect(() => {
    void reloadCard()
  }, [reloadCard])

  // Availability, debounced.
  //
  // The engine owns both the slug rules and uniqueness, so this asks it rather
  // than reimplementing either in the browser. Debounced at 400ms because it
  // fires per keystroke, and the stale-response guard matters more than the
  // debounce: replies can arrive out of order, and the wrong one landing last
  // would show "available" for a name the user has already typed past.
  useEffect(() => {
    const typed = name.trim()
    if (typed.length === 0) {
      setNameCheck(null)
      setCheckingName(false)
      return
    }
    setCheckingName(true)
    let current = true
    const t = setTimeout(() => {
      taskclanFetch(`/api/taskclan/site-check?name=${encodeURIComponent(typed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (!current) return
          setNameCheck(b && typeof b.valid === 'boolean' ? (b as NameCheck) : null)
          setCheckingName(false)
        })
        .catch(() => {
          if (!current) return
          // A failed check must not read as "taken". Fall back to saying
          // nothing and let the engine be the one to reject on submit.
          setNameCheck(null)
          setCheckingName(false)
        })
    }, 400)
    return () => {
      current = false
      clearTimeout(t)
    }
  }, [name])

  // GitHub repos, only when the user chooses to import one.
  useEffect(() => {
    if (source !== 'github' || repos !== null) return
    taskclanFetch('/api/taskclan/github/repos')
      .then((r) => r.json())
      .then((b) => setRepos(Array.isArray(b?.repos) ? (b.repos as Repo[]) : []))
      .catch(() => setRepos([]))
  }, [source, repos])

  // Start the GitHub App install/connect flow. Cloud signs the install state, so
  // the URL must come from it; returnTo brings the person back to this form to
  // pick their repo once a repository is available.
  const [isConnectingGitHub, setIsConnectingGitHub] = useState(false)
  const connectGitHub = async () => {
    setIsConnectingGitHub(true)
    try {
      const returnTo = window.location.href
      const res = await taskclanFetch(
        `/api/taskclan/github/connect?returnTo=${encodeURIComponent(returnTo)}`
      )
      const body = await res.json()
      if (!res.ok || !body?.url) {
        toast.error(body?.error ?? 'Could not start the GitHub connection')
        return
      }
      window.location.href = body.url as string
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the GitHub connection')
    } finally {
      setIsConnectingGitHub(false)
    }
  }

  const dbOptions = useMemo(() => {
    const out: { value: string; title: string; blurb: string; price: string }[] = []
    const provs = dbInfo?.managedPostgresProviders ?? []
    if (provs.includes('supabase')) {
      for (const p of dbInfo?.supabasePlans ?? [])
        out.push({
          value: `supabase:${p.id}`,
          title: `Supabase · ${p.label}`,
          blurb: p.blurb ?? 'Dedicated Supabase project',
          price: price(p.priceCredits),
        })
    }
    if (provs.includes('neon')) {
      for (const p of dbInfo?.plans ?? [])
        out.push({
          value: `neon:${p.id}`,
          title: `Neon · ${p.label}`,
          blurb: p.blurb ?? 'Managed Postgres',
          price: price(p.priceCredits),
        })
    }
    // Bring-your-own developers: authorize their own Supabase (a dedicated
    // project is created in their org, $3/mo service fee), or paste any
    // Postgres connection string. Both attach to the new app after it is
    // created, so they belong on this form too.
    if (dbInfo?.supabaseOAuth) {
      out.push({
        value: OWN_SUPABASE,
        title: 'Your own Supabase (one-click)',
        blurb: 'Authorize your Supabase account — a dedicated project is created in your org',
        price: '$3/mo service fee',
      })
    }
    out.push({
      value: BYO,
      title: 'Bring your own',
      blurb: 'Paste a Postgres connection string',
      price: 'Free',
    })
    return out
  }, [dbInfo])

  useEffect(() => {
    if (dbMode === 'add' && !dbChoice && dbOptions.length) setDbChoice(dbOptions[0].value)
  }, [dbMode, dbChoice, dbOptions])

  const isByo = dbChoice === BYO
  const isOauth = dbChoice === OWN_SUPABASE
  const selectedDbOption = dbOptions.find((o) => o.value === dbChoice)
  const selectedRepo = repos?.find((r) => r.fullName === repo)
  // The size the engine will actually provision, not the raw input. Shown and
  // sent as the same number so the form cannot claim one and get another.
  const appliedMaxInstances = instances
    ? clampMaxInstances(maxInstances, autoscale, instances.autoscale)
    : maxInstances
  const selectedInstance = instances?.types.find((t) => t.id === instanceType)
  const isService = type === 'service'
  // A web service runs a paid container. Require a card before it can be created;
  // only hard-gate on a definite "no card" (null = unknown, left to the engine).
  const needsCard = isService && hasCard === false
  // The size picker is only meaningful where a deploy will apply it (a repo
  // import). Hide it while a card is still required — the card CTA takes its
  // place — and show it otherwise (locked sizes stay disabled until postpaid).
  const showSizePicker = isService && source === 'github' && !!instances && hasCard !== false
  const showServicePanel =
    isService && (needsCard || showSizePicker || (hasCard === true && source === 'empty'))
  const availability = availabilityMessage(nameCheck, {
    checking: checkingName,
    typed: name.trim().length > 0,
  })
  // Only block on a definite "no". A check that failed or has not answered
  // leaves the button live and lets the engine be the one to refuse.
  const isNameRejected = !!nameCheck && (!nameCheck.valid || !nameCheck.available)

  const canSubmit =
    name.trim().length > 0 &&
    !isNameRejected &&
    !checkingName &&
    (source === 'empty' || (source === 'github' && repo)) &&
    (dbMode === 'none' || (!!dbChoice && (!isByo || byoUrl.trim().length > 0))) &&
    !busy

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      // 1) Create the app. Always the same call: the engine's `POST /sites`
      // takes a name and nothing else, and the repo is linked by the deploy in
      // step 2. There used to be a separate "import" path here that posted to
      // /api/cloud/v1/import/run — an endpoint the engine does not have — so
      // every GitHub import failed at the first request.
      const createRes = await fetch('/api/platform/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type }),
      })
      const project = await createRes.json().catch(() => ({}))
      if (!createRes.ok) {
        setError(project?.error?.message || project?.error || 'Could not create the project')
        setBusy(false)
        return
      }
      const ref: string = project.ref
      toast.success(`Created ${name.trim()}`)

      // 2) Link the repo and run the first build, carrying the chosen size.
      // This is also where sizing is actually applied: `POST /sites` ignores it,
      // and `deploy-service` is what writes instance_type and max_instances.
      if (source === 'github' && repo) {
        toast.info(`Building ${repo}…`)
        const deployRes = await taskclanFetch(`/api/taskclan/${ref}/deploy-from-repo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repo,
            branch: branch || selectedRepo?.defaultBranch,
            type,
            installationId: selectedRepo?.installationId,
            ...(type === 'service'
              ? { instanceType, autoscale, maxInstances: appliedMaxInstances }
              : {}),
          }),
        })
        if (!deployRes.ok) {
          const b = await deployRes.json().catch(() => ({}))
          // The app exists and is the user's; do not strand them on a form.
          // Land them on it and say which step needs another go.
          toast.error(
            `${name.trim()} was created, but the build could not be started: ${b.error || deployRes.status}. Deploy it from the project's Deployments page.`
          )
        }
      }

      // 2) Attach a database to the new app, if chosen. Every kind resolves
      // against the ref, which is why the app is created first.
      const dbName = `${name.trim()} database`
      if (dbMode === 'add' && isOauth) {
        // One-click "your own Supabase": mint the authorize URL server-side and
        // hand the browser to Supabase. The engine callback provisions in the
        // customer's org, attaches to this app, and returns to the new project —
        // so this path redirects to Supabase, not to /project/{ref}.
        toast.info('Redirecting to Supabase to authorize…')
        const res = await taskclanFetch(`/api/taskclan/${ref}/provision-supabase-oauth`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            plan: 'starter',
            name: dbName,
            returnUrl: `${window.location.origin}/project/${ref}`,
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || !body.url) {
          toast.error(
            `Project created, but the Supabase connection could not be started: ${body.error || res.status}. Try again from the project's Database page.`
          )
          router.push(`/project/${ref}`)
          return
        }
        window.location.href = body.url as string
        return
      }

      if (dbMode === 'add' && dbChoice) {
        const payload = isByo
          ? { url: byoUrl.trim(), name: dbName }
          : (() => {
              const [provider, plan] = dbChoice.split(':')
              return { action: 'provision', provider, plan, name: dbName }
            })()
        toast.info(isByo ? 'Connecting the database…' : 'Provisioning the database…')
        const dbRes = await taskclanFetch(`/api/taskclan/${ref}/databases`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!dbRes.ok) {
          const b = await dbRes.json().catch(() => ({}))
          // The app exists; do not strand the user. Land them on the project and
          // tell them the database step is the part that needs another try.
          toast.error(
            `Project created, but the database could not be ${isByo ? 'connected' : 'provisioned'}: ${b.error || dbRes.status}. Add one from the project's Database page.`
          )
        } else {
          toast.success(isByo ? 'Database connected' : 'Database provisioned')
        }
      }

      // 3) Into the new project.
      router.push(`/project/${ref}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  // Adding a card enrols pay-as-you-go and unlocks every size. Don't auto-create
  // afterwards — reveal the now-unlocked picker and let the user choose a size,
  // then create — so an import doesn't silently ship on the default size.
  const onCardAdded = async () => {
    setShowAddCard(false)
    setHasCard(true)
    await reloadInstances()
    toast.success("Payment method added — you're on pay-as-you-go. Pick a size and create your project.")
  }

  // The primary action: a web service with no card opens the billing modal
  // first; everything else creates straight away.
  const handlePrimary = () => {
    if (needsCard) {
      setShowAddCard(true)
      return
    }
    void submit()
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl text-foreground">Create a new project</h1>
        <p className="text-sm text-foreground-light">
          A project is a Taskclan Cloud app. Start it empty or import a GitHub repo, and optionally
          give it its own database.
        </p>
      </div>

      <Panel>
        <Panel.Content className="flex flex-col gap-6">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tc-project-name" className="text-sm text-foreground">
              Project name
            </label>
            <Input
              id="tc-project-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-new-app"
            />
            {availability.tone === 'checking' && (
              <p className="flex items-center gap-1.5 text-xs text-foreground-lighter">
                <Loader2 className="animate-spin" size={12} /> {availability.text}
              </p>
            )}
            {availability.tone === 'ok' && (
              <p className="flex items-center gap-1.5 text-xs text-brand">
                <Check size={12} /> <span className="font-mono">{availability.text}</span>
              </p>
            )}
            {availability.tone === 'error' && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <TriangleAlert size={12} /> {availability.text}
              </p>
            )}
          </div>

          {/* Type */}
          <div className="flex flex-col gap-2">
            <label className="text-sm text-foreground">App type</label>
            <RadioGroupStacked
              value={type}
              onValueChange={(v) => setType(v as 'service' | 'static')}
            >
              <RadioGroupStackedItem
                value="service"
                label="Web service"
                description="A running app in a container (API, SSR, backend)."
              />
              <RadioGroupStackedItem
                value="static"
                label="Static site"
                description="Prebuilt static files served from the edge."
              />
            </RadioGroupStacked>
          </div>
        </Panel.Content>

        <Panel.Content className="border-t border-default flex flex-col gap-2">
          <label className="text-sm text-foreground">Source</label>
          <RadioGroupStacked
            value={source}
            onValueChange={(v) => setSource(v as 'empty' | 'github')}
          >
            <RadioGroupStackedItem
              value="empty"
              label="Start empty"
              description="Create the app now and deploy to it later."
            />
            <RadioGroupStackedItem
              value="github"
              label="Import from GitHub"
              description="Link a repository — Taskclan Cloud builds and deploys it."
            />
          </RadioGroupStacked>

          {source === 'github' && (
            <div className="mt-2 flex flex-col gap-3">
              {repos === null ? (
                <div className="flex items-center gap-2 text-sm text-foreground-light">
                  <Loader2 className="animate-spin" size={14} /> Loading repositories…
                </div>
              ) : repos.length === 0 ? (
                <>
                  <Admonition
                    type="default"
                    title="No repositories available"
                    description="No GitHub account is connected to this workspace, or the app has access to no repositories. Connect the Taskclan Cloud GitHub App to import a repository."
                  />
                  <Button
                    type="button"
                    icon={<Github />}
                    loading={isConnectingGitHub}
                    onClick={connectGitHub}
                    className="self-start"
                  >
                    Connect to GitHub
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-foreground-light">Repository</label>
                    <Select
                      value={repo}
                      onValueChange={(v) => {
                        setRepo(v)
                        const r = repos.find((x) => x.fullName === v)
                        setBranch(r?.defaultBranch ?? '')
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a repository…" />
                      </SelectTrigger>
                      <SelectContent>
                        {repos.map((r) => (
                          <SelectItem key={r.fullName} value={r.fullName}>
                            <span className="flex items-center gap-2">
                              <Github size={13} /> {r.fullName}
                              {r.private && (
                                <span className="rounded bg-surface-200 px-1 text-[10px] uppercase text-foreground-lighter">
                                  private
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedRepo && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-foreground-light">Branch</label>
                      <Input
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder={selectedRepo.defaultBranch}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </Panel.Content>

        {showServicePanel && (
          <Panel.Content className="border-t border-default flex flex-col gap-4">
            {/* A web service always runs a paid container, so a card is required
                before one can be created. */}
            {needsCard && (
              <div className="flex flex-col gap-2">
                <Admonition
                  type="default"
                  title="Add a payment method to run a web service"
                  description="A web service runs in a container billed by the minute. Add a card to unlock every container size and deploy — you're then billed monthly for exactly what you use, and it scales to zero when idle."
                />
                <Button
                  type="button"
                  icon={<CreditCard />}
                  onClick={() => setShowAddCard(true)}
                  className="self-start"
                >
                  Add payment method
                </Button>
              </div>
            )}

            {showSizePicker && instances && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tc-instance-size" className="text-sm text-foreground">
                    Container size
                  </label>
                  <Select value={instanceType} onValueChange={setInstanceType}>
                    <SelectTrigger id="tc-instance-size">
                      <SelectValue placeholder="Select a size…" />
                    </SelectTrigger>
                    <SelectContent>
                      {instances.types.map((t) => (
                        <SelectItem key={t.id} value={t.id} disabled={t.locked}>
                          {describeInstance(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedInstance && (
                    <p className="text-xs text-foreground-lighter">
                      {describeCost(selectedInstance, instances.scalesToZero)}
                    </p>
                  )}
                  {hasCard === true && (
                    <p className="text-xs text-foreground-light">
                      You&apos;re on pay-as-you-go — this size is billed on your monthly invoice.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-foreground">Autoscaling</p>
                    <p className="text-xs text-foreground-light">
                      {instances.autoscale.allowed
                        ? 'Run more copies under load. Off means exactly one instance.'
                        : `Available on ${instances.autoscale.minPlan} and above.`}
                    </p>
                  </div>
                  <Switch
                    checked={autoscale}
                    disabled={!instances.autoscale.allowed}
                    onCheckedChange={setAutoscale}
                  />
                </div>

                {autoscale && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="tc-max-instances" className="text-xs text-foreground-light">
                      Maximum instances
                    </label>
                    <Input
                      id="tc-max-instances"
                      type="number"
                      min={2}
                      max={instances.autoscale.max}
                      value={maxInstances}
                      onChange={(e) => setMaxInstances(Number(e.target.value))}
                      className="w-28"
                    />
                    {appliedMaxInstances !== maxInstances && (
                      <p className="text-xs text-warning">
                        Your plan allows up to {instances.autoscale.max}. This app will scale to{' '}
                        {appliedMaxInstances}.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Empty service app with a card: the size is chosen at first deploy. */}
            {hasCard === true && source === 'empty' && (
              <p className="text-xs text-foreground-light">
                You&apos;re on pay-as-you-go — billed monthly for what you use. You&apos;ll choose a
                container size when you deploy.
              </p>
            )}
          </Panel.Content>
        )}

        <Panel.Content className="border-t border-default flex flex-col gap-2">
          <label className="text-sm text-foreground">Database</label>
          <RadioGroupStacked value={dbMode} onValueChange={(v) => setDbMode(v as 'none' | 'add')}>
            <RadioGroupStackedItem
              value="none"
              label="No database yet"
              description="Use the shared database, or add one later from the project."
            />
            <RadioGroupStackedItem
              value="add"
              label="Add a database"
              description="A managed database (Supabase/Neon), your own Supabase, or your own connection string."
              disabled={dbOptions.length === 0}
            />
          </RadioGroupStacked>

          {dbMode === 'add' && (
            <div className="mt-2 flex flex-col gap-3">
              <Select value={dbChoice} onValueChange={setDbChoice}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a database…" />
                </SelectTrigger>
                <SelectContent>
                  {dbOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="flex w-full items-center justify-between gap-4">
                        <span>{o.title}</span>
                        <span className="text-foreground-lighter">{o.price}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isByo && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tc-byo-url" className="text-xs text-foreground-light">
                    Connection string
                  </label>
                  <Input
                    id="tc-byo-url"
                    type="password"
                    value={byoUrl}
                    onChange={(e) => setByoUrl(e.target.value)}
                    placeholder="postgresql://user:password@host:5432/database"
                    autoComplete="off"
                  />
                </div>
              )}

              {isByo ? (
                <Admonition
                  type="default"
                  title="Bring your own database"
                  description="Stored as this app's DATABASE_URL secret and injected on the next deploy. No charge."
                />
              ) : isOauth ? (
                <Admonition
                  type="default"
                  title="You'll be redirected to Supabase"
                  description="Authorize your Supabase account — a dedicated project is created in your own org and connected to this app. $3/mo service fee, billed to the org wallet."
                />
              ) : (
                <Admonition
                  type="default"
                  title="Billed monthly to your org wallet"
                  description={`A dedicated database is a real, paid project${selectedDbOption ? ` (${selectedDbOption.price})` : ''}. It is charged on creation and monthly thereafter.`}
                />
              )}
            </div>
          )}
        </Panel.Content>

        {error && (
          <Panel.Content className="border-t border-default">
            <Admonition type="danger" title="Could not create the project" description={error} />
          </Panel.Content>
        )}

        <Panel.Content className="border-t border-default flex items-center justify-between">
          <Button
            variant="default"
            disabled={busy}
            onClick={() => router.push(slug ? `/org/${slug}` : '/projects')}
          >
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!canSubmit} onClick={handlePrimary}>
            {needsCard
              ? 'Add payment method to continue'
              : source === 'github'
                ? 'Import project'
                : 'Create project'}
          </Button>
        </Panel.Content>
      </Panel>

      <TaskclanAddCardModal
        visible={showAddCard}
        onCancel={() => setShowAddCard(false)}
        onDone={onCardAdded}
      />
    </div>
  )
}

export default TaskclanProjectCreationForm
