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
 *   - Database (optional): none, or a dedicated managed database (Supabase/Neon)
 *     provisioned against the new app and billed to the org wallet.
 *
 * Orchestrated client-side so each step gives its own feedback and a later
 * failure (e.g. the database) does not lose the app that was already created.
 */
import { useParams } from 'common'
import { Github, Loader2 } from 'lucide-react'
import { useRouter } from 'next/router'
import { useEffect, useMemo, useState } from 'react'
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
} from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import Panel from '@/components/ui/Panel'

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
}
interface Repo {
  fullName: string
  defaultBranch: string
  private: boolean
  installationId: number
  owner: string
}

/** 1 credit = $0.001, so credits/1000 = dollars/month. */
const price = (credits: number) => (credits === 0 ? 'Free' : `$${Math.round(credits / 1000)}/mo`)

/** Display-only preview of the subdomain the engine will slugify the name into. */
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

export const TaskclanProjectCreationForm = () => {
  const router = useRouter()
  const { slug } = useParams()

  const [name, setName] = useState('')
  const [type, setType] = useState<'service' | 'static'>('service')
  const [source, setSource] = useState<'empty' | 'github'>('empty')
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('')

  const [dbMode, setDbMode] = useState<'none' | 'dedicated'>('none')
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)
  const [dbChoice, setDbChoice] = useState('') // "supabase:starter" | "neon:standard" | ...

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Managed database catalogue (providers + tiers). Fetched once — it is the
  // same for every app in the org.
  useEffect(() => {
    fetch('/api/taskclan/db-plans')
      .then((r) => r.json())
      .then((b) => setDbInfo(b as DbInfo))
      .catch(() => setDbInfo({}))
  }, [])

  // GitHub repos, only when the user chooses to import one.
  useEffect(() => {
    if (source !== 'github' || repos !== null) return
    fetch('/api/taskclan/github/repos')
      .then((r) => r.json())
      .then((b) => setRepos(Array.isArray(b?.repos) ? (b.repos as Repo[]) : []))
      .catch(() => setRepos([]))
  }, [source, repos])

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
    return out
  }, [dbInfo])

  useEffect(() => {
    if (dbMode === 'dedicated' && !dbChoice && dbOptions.length) setDbChoice(dbOptions[0].value)
  }, [dbMode, dbChoice, dbOptions])

  const selectedRepo = repos?.find((r) => r.fullName === repo)
  const canSubmit =
    name.trim().length > 0 &&
    (source === 'empty' || (source === 'github' && repo)) &&
    (dbMode === 'none' || !!dbChoice) &&
    !busy

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      // 1) Create the app (empty, or imported from a GitHub repo).
      const createRes =
        source === 'github'
          ? await fetch('/api/platform/projects/import', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ repo, branch: branch || selectedRepo?.defaultBranch, name: name.trim() }),
            })
          : await fetch('/api/platform/projects', {
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
      toast.success(
        source === 'github' ? `Importing ${repo} into ${name.trim()}` : `Created ${name.trim()}`
      )

      // 2) Provision a dedicated database against the new app, if chosen.
      if (dbMode === 'dedicated' && dbChoice) {
        const [provider, plan] = dbChoice.split(':')
        toast.info('Provisioning the database…')
        const dbRes = await fetch(`/api/taskclan/${ref}/databases`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'provision', provider, plan, name: `${name.trim()} database` }),
        })
        if (!dbRes.ok) {
          const b = await dbRes.json().catch(() => ({}))
          // The app exists; do not strand the user. Land them on the project and
          // tell them the database step is the part that needs another try.
          toast.error(
            `Project created, but the database could not be provisioned: ${b.error || dbRes.status}. Add one from the project's Database page.`
          )
        } else {
          toast.success('Database provisioned')
        }
      }

      // 3) Into the new project.
      router.push(`/project/${ref}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const preview = slugify(name)

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
            {preview && (
              <p className="text-xs text-foreground-lighter">
                URL: <span className="font-mono">{preview}.cloud.taskclan.com</span>
              </p>
            )}
          </div>

          {/* Type */}
          <div className="flex flex-col gap-2">
            <label className="text-sm text-foreground">App type</label>
            <RadioGroupStacked value={type} onValueChange={(v) => setType(v as 'service' | 'static')}>
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
          <RadioGroupStacked value={source} onValueChange={(v) => setSource(v as 'empty' | 'github')}>
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
                <Admonition
                  type="default"
                  title="No repositories available"
                  description="No GitHub account is connected to this workspace, or the app has access to no repositories. Connect the Taskclan Cloud GitHub App, then reload."
                />
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
                      <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={selectedRepo.defaultBranch} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </Panel.Content>

        <Panel.Content className="border-t border-default flex flex-col gap-2">
          <label className="text-sm text-foreground">Database</label>
          <RadioGroupStacked value={dbMode} onValueChange={(v) => setDbMode(v as 'none' | 'dedicated')}>
            <RadioGroupStackedItem
              value="none"
              label="No database yet"
              description="Use the shared database, or add one later from the project."
            />
            <RadioGroupStackedItem
              value="dedicated"
              label="Dedicated database"
              description="Provision a managed database for this app (billed to the org wallet)."
              disabled={dbOptions.length === 0}
            />
          </RadioGroupStacked>

          {dbMode === 'dedicated' && (
            <div className="mt-2 flex flex-col gap-3">
              <Select value={dbChoice} onValueChange={setDbChoice}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a plan…" />
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
              <Admonition
                type="default"
                title="Billed monthly to your org wallet"
                description="A dedicated database is a real, paid project. It is charged on creation and monthly thereafter."
              />
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
          <Button variant="primary" loading={busy} disabled={!canSubmit} onClick={submit}>
            {source === 'github' ? 'Import project' : 'Create project'}
          </Button>
        </Panel.Content>
      </Panel>
    </div>
  )
}

export default TaskclanProjectCreationForm
