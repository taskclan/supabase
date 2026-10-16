/**
 * Taskclan Cloud's "Migrate from Heroku or Vercel" form.
 *
 * The whole import backend already lives in the engine; this is the console face
 * for it. Pick a platform, paste a read token for that platform, choose the
 * app/project, preview exactly what comes across — and, stated plainly, what will
 * not — then run the migration in one shot.
 *
 * The source-platform token travels only in the body of each request, to the
 * console's own `/api/taskclan/import/*` proxies, and is never stored or logged
 * here. The engine rebuilds the plan from that token server-side, so config-var
 * and env VALUES never round-trip through the browser — the preview carries only
 * counts and the names of things.
 *
 * Every call goes through taskclanFetch, so it carries the signed-in user's JWT
 * and active org; the engine gates importing on that user's role.
 */
import { useParams } from 'common'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useRouter } from 'next/router'
import { useState } from 'react'
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

import Panel from '@/components/ui/Panel'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

type Platform = 'heroku' | 'vercel'

interface HerokuApp {
  name: string
  region?: string | null
  pipeline?: string | null
  stage?: string | null
}

/** The engine's Heroku import preview (`import/heroku/plan` → { preview }). */
interface HerokuPlan {
  source: string
  name: string
  region: string | null
  repo: string | null
  envCount: number
  database: { engine: string; envKey: string } | null
  addons: Array<{ sourceName: string; mappedType: string | null; importable: boolean; note: string }>
  suggestedInstanceType: string
  pipeline: { name: string; stage: string } | null
  flagged: Array<{ name: string; reason: string }>
}

/** The engine's Vercel import plan (`import/vercel/preview` → { plan, summary }). */
interface VercelPlan {
  site: { name: string; subdomain: string; type: string; rootDir: string | null }
  build: { strategy: string; framework: string | null; notModelled: string[] }
  env: Array<{ key: string; scope: string; copyable: boolean; reason?: string }>
  domains: string[]
  notSurviving: Array<{ item: string; effect: 'dropped' | 'degraded' | 'manual'; detail: string }>
  manualEnvCount: number
}
interface VercelSummary {
  envTotal: number
  envNeedingManualEntry: number
  domains: number
  willNotSurvive: number
}

type Preview =
  | { kind: 'heroku'; plan: HerokuPlan }
  | { kind: 'vercel'; plan: VercelPlan; summary: VercelSummary }

/** The engine returns human sentences under `error`; surface them verbatim. */
const engineError = (body: unknown): string | null => {
  const e = (body as { error?: unknown })?.error
  return typeof e === 'string' && e ? e : null
}
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
const REPO_RE = /^[\w.-]+\/[\w.-]+$/
const normalizeRepo = (raw: string) =>
  raw.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/$/, '')

export const TaskclanMigrateForm = () => {
  const router = useRouter()
  const { slug } = useParams()

  const [platform, setPlatform] = useState<Platform>('heroku')
  const [token, setToken] = useState('')

  // Heroku: list apps under the token, then pick one.
  const [apps, setApps] = useState<HerokuApp[] | null>(null)
  const [selectedApp, setSelectedApp] = useState('')

  // Vercel: name the project (and, for a team project, its team id).
  const [project, setProject] = useState('')
  const [teamId, setTeamId] = useState('')

  const [preview, setPreview] = useState<Preview | null>(null)
  // The repo to build a Heroku app from (owner/name). Pre-filled from the plan's
  // detected repo, editable — a private repo needs GitHub connected first. Vercel
  // detects the repo server-side from the project's git link, so it has no field.
  const [repo, setRepo] = useState('')
  // "Copy my database data too" — OFF points the app at the same database
  // (dbMode 'connect'); ON provisions a managed Postgres and copies into it
  // (dbMode 'migrate'). Only meaningful when the plan has a Postgres database.
  const [copyDb, setCopyDb] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Changing the platform invalidates everything downstream, the token included:
  // a Heroku token is meaningless to Vercel and must not be sent there.
  const onPlatform = (p: Platform) => {
    setPlatform(p)
    setToken('')
    setApps(null)
    setSelectedApp('')
    setProject('')
    setTeamId('')
    setPreview(null)
    setRepo('')
    setCopyDb(false)
    setError(null)
  }

  // Any change to an input the preview was built from makes it stale.
  const invalidatePreview = () => {
    if (preview) setPreview(null)
  }

  const listHerokuApps = async () => {
    const t = token.trim()
    if (!t) return
    setBusy(true)
    setError(null)
    setApps(null)
    setSelectedApp('')
    setPreview(null)
    try {
      const res = await taskclanFetch('/api/taskclan/import/heroku/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: t }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(engineError(body) || 'Could not list your Heroku apps.')
        return
      }
      const list = Array.isArray((body as { apps?: unknown }).apps)
        ? ((body as { apps: HerokuApp[] }).apps)
        : []
      setApps(list)
      if (list.length === 0) setError('No apps found for that token.')
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const previewHeroku = async () => {
    const t = token.trim()
    if (!t || !selectedApp) return
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const res = await taskclanFetch('/api/taskclan/import/heroku/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: t, app: selectedApp }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(engineError(body) || 'Could not read that app.')
        return
      }
      // The engine returns { preview }; accept { plan } too in case the contract
      // is renamed, so the form does not break on a harmless rename.
      const plan = ((body as { preview?: HerokuPlan; plan?: HerokuPlan }).preview ??
        (body as { plan?: HerokuPlan }).plan) as HerokuPlan | undefined
      if (!plan) {
        setError('The preview came back empty.')
        return
      }
      setPreview({ kind: 'heroku', plan })
      setRepo(plan.repo || '')
      setCopyDb(false)
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const previewVercel = async () => {
    const t = token.trim()
    const p = project.trim()
    if (!t || !p) return
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const res = await taskclanFetch('/api/taskclan/import/vercel/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: t, project: p, teamId: teamId.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(engineError(body) || 'Could not read that project.')
        return
      }
      const plan = (body as { plan?: VercelPlan }).plan
      if (!plan) {
        setError('The preview came back empty.')
        return
      }
      const summary = ((body as { summary?: VercelSummary }).summary ?? {
        envTotal: plan.env.length,
        envNeedingManualEntry: plan.manualEnvCount,
        domains: plan.domains.length,
        willNotSurvive: plan.notSurviving.length,
      }) as VercelSummary
      setPreview({ kind: 'vercel', plan, summary })
      setCopyDb(false)
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const runMigration = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const dbMode = copyDb ? 'migrate' : 'connect'
      const appName = preview.kind === 'heroku' ? preview.plan.name : preview.plan.site.name
      const runBody =
        preview.kind === 'heroku'
          ? {
              source: 'heroku',
              heroku: { token: token.trim(), app: selectedApp },
              // The engine falls back to the plan's own repo when this is blank.
              repo: normalizeRepo(repo),
              dbMode,
              name: appName,
            }
          : {
              source: 'vercel',
              vercel: {
                token: token.trim(),
                project: project.trim(),
                teamId: teamId.trim() || undefined,
              },
              dbMode,
              name: appName,
            }
      const res = await taskclanFetch('/api/taskclan/import/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(runBody),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(engineError(body) || 'The migration could not be started.')
        setBusy(false)
        return
      }
      // The run answers with result.siteId — a UUID, not the subdomain the
      // project routes key on. Rather than push a UUID a freshly-cached project
      // list might not resolve yet, land on the project list (the app is created
      // before run answers, so it is there) and name it in the toast. Keep `busy`
      // true through the navigation so the button cannot fire twice.
      toast.success(`Migrating ${appName}… it will appear in your projects as it builds.`)
      router.push('/projects')
    } catch (e) {
      setError(errMessage(e))
      setBusy(false)
    }
  }

  const repoOk = REPO_RE.test(normalizeRepo(repo))
  const canPreview =
    !busy && token.trim().length > 0 && (platform === 'heroku' ? !!selectedApp : project.trim().length > 0)
  // Heroku needs a resolvable repo; Vercel detects it server-side. Mirroring the
  // engine's owner/name check here means the person sees the problem before they
  // tap, rather than as a round-trip rejection.
  const canRun = !!preview && !busy && (preview.kind === 'vercel' || repoOk)
  const showDbToggle = preview?.kind === 'heroku' && preview.plan.database?.engine === 'postgres'

  const cancelHref = slug ? `/new/${slug}` : '/projects'

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => router.push(cancelHref)}
          className="mb-3 flex items-center gap-1.5 text-xs text-foreground-light hover:text-foreground"
        >
          <ArrowLeft size={13} /> Back to create a project
        </button>
        <h1 className="text-xl text-foreground">Migrate an app to Taskclan Cloud</h1>
        <p className="text-sm text-foreground-light">
          Bring an app over from Heroku or Vercel in one shot. Taskclan copies its config, connects
          its database and builds it here — and tells you plainly what won&apos;t come across.
        </p>
      </div>

      <Panel>
        {/* Platform */}
        <Panel.Content className="flex flex-col gap-2">
          <label className="text-sm text-foreground">Platform</label>
          <RadioGroupStacked value={platform} onValueChange={(v) => onPlatform(v as Platform)}>
            <RadioGroupStackedItem
              value="heroku"
              label="Heroku"
              description="Read your apps with a Heroku API token, then pick one to bring over."
            />
            <RadioGroupStackedItem
              value="vercel"
              label="Vercel"
              description="Read a project with a Vercel access token — its repo is detected for you."
            />
          </RadioGroupStacked>
        </Panel.Content>

        {/* Token + source */}
        <Panel.Content className="border-t border-default flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tc-migrate-token" className="text-sm text-foreground">
              {platform === 'heroku' ? 'Heroku API token' : 'Vercel access token'}
            </label>
            <div className="flex gap-2">
              <Input
                id="tc-migrate-token"
                type="password"
                className="flex-1"
                autoComplete="off"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setApps(null)
                  setSelectedApp('')
                  invalidatePreview()
                }}
                placeholder={platform === 'heroku' ? 'paste your Heroku token' : 'paste your Vercel token'}
              />
              {platform === 'heroku' && (
                <Button
                  type="button"
                  loading={busy && apps === null}
                  disabled={busy || token.trim().length === 0}
                  onClick={listHerokuApps}
                >
                  List apps
                </Button>
              )}
            </div>
            <p className="text-xs text-foreground-lighter">
              {platform === 'heroku' ? (
                <>
                  Create one with <code className="font-mono">heroku authorizations:create</code>. Used
                  once to read your app; never stored.
                </>
              ) : (
                <>
                  A Vercel access token from Account Settings &rarr; Tokens. Used once to read your
                  project; never stored.
                </>
              )}
            </p>
          </div>

          {platform === 'heroku' && apps !== null && apps.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-foreground-light">App</label>
              <Select
                value={selectedApp}
                onValueChange={(v) => {
                  setSelectedApp(v)
                  invalidatePreview()
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an app…" />
                </SelectTrigger>
                <SelectContent>
                  {apps.map((a) => (
                    <SelectItem key={a.name} value={a.name}>
                      <span className="flex items-center gap-2">
                        <span className="font-mono">{a.name}</span>
                        {a.pipeline && (
                          <span className="text-foreground-lighter">· {a.pipeline}</span>
                        )}
                        {a.stage && (
                          <span className="rounded bg-surface-200 px-1 text-[10px] uppercase text-foreground-lighter">
                            {a.stage}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {platform === 'vercel' && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tc-vercel-project" className="text-xs text-foreground-light">
                  Project id or name
                </label>
                <Input
                  id="tc-vercel-project"
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value)
                    invalidatePreview()
                  }}
                  placeholder="my-vercel-project"
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tc-vercel-team" className="text-xs text-foreground-light">
                  Team id <span className="text-foreground-lighter">· optional, for a team project</span>
                </label>
                <Input
                  id="tc-vercel-team"
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value)
                    invalidatePreview()
                  }}
                  placeholder="team_…"
                  autoComplete="off"
                />
              </div>
            </>
          )}

          <Button
            type="button"
            variant="secondary"
            className="self-start"
            loading={busy && preview === null && (platform === 'vercel' || apps !== null)}
            disabled={!canPreview}
            onClick={platform === 'heroku' ? previewHeroku : previewVercel}
          >
            Preview migration
          </Button>
        </Panel.Content>

        {/* Preview */}
        {preview && (
          <Panel.Content className="border-t border-default flex flex-col gap-4">
            {preview.kind === 'heroku' ? (
              <HerokuPreview
                plan={preview.plan}
                repo={repo}
                repoOk={repoOk}
                onRepo={(v) => setRepo(v)}
              />
            ) : (
              <VercelPreview plan={preview.plan} summary={preview.summary} />
            )}

            {showDbToggle && (
              <div className="flex items-center justify-between gap-4 rounded border border-default px-3 py-2.5">
                <div>
                  <p className="text-sm text-foreground">Copy my database data too</p>
                  <p className="text-xs text-foreground-light">
                    Off — your app points at the same database. On — we provision a managed Postgres
                    and copy your data into it.
                  </p>
                </div>
                <Switch checked={copyDb} onCheckedChange={setCopyDb} />
              </div>
            )}
          </Panel.Content>
        )}

        {error && (
          <Panel.Content className="border-t border-default">
            <Admonition type="warning" title="Migration error" description={error} />
          </Panel.Content>
        )}

        {/* Actions */}
        <Panel.Content className="border-t border-default flex items-center justify-between">
          <Button variant="default" disabled={busy} onClick={() => router.push(cancelHref)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy && !!preview} disabled={!canRun} onClick={runMigration}>
            Migrate &amp; deploy
          </Button>
        </Panel.Content>
      </Panel>

      {busy && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-foreground-lighter">
          <Loader2 className="animate-spin" size={12} /> Working…
        </p>
      )}
    </div>
  )
}

/** The Heroku plan, and the editable repo the app will build from. */
function HerokuPreview({
  plan,
  repo,
  repoOk,
  onRepo,
}: {
  plan: HerokuPlan
  repo: string
  repoOk: boolean
  onRepo: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm text-foreground">Import preview</h2>
        <p className="text-xs text-foreground-light">
          <span className="font-mono">{plan.name}</span>
          {plan.region ? ` · ${plan.region}` : ''}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-foreground-lighter">Config vars</dt>
          <dd className="text-foreground">{plan.envCount} copied as secrets</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-foreground-lighter">Database</dt>
          <dd className="text-foreground">
            {plan.database ? (
              <span className="font-mono">
                {plan.database.engine} · {plan.database.envKey}
              </span>
            ) : (
              <span className="text-foreground-light">none detected</span>
            )}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-foreground-lighter">Suggested size</dt>
          <dd className="font-mono text-foreground">{plan.suggestedInstanceType}</dd>
        </div>
        {plan.pipeline && (
          <div className="flex flex-col">
            <dt className="text-xs uppercase tracking-wide text-foreground-lighter">Pipeline</dt>
            <dd className="text-foreground">
              {plan.pipeline.name} <span className="text-foreground-light">· {plan.pipeline.stage}</span>
            </dd>
          </div>
        )}
      </dl>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tc-heroku-repo" className="text-xs text-foreground-light">
          Build from repo (owner/name)
        </label>
        <Input
          id="tc-heroku-repo"
          value={repo}
          onChange={(e) => onRepo(e.target.value)}
          placeholder="owner/repo"
          autoComplete="off"
        />
        <p className="text-xs text-foreground-lighter">
          {plan.repo ? 'Detected from the app — edit if needed. ' : ''}A private repo needs GitHub
          connected first.
        </p>
        {repo.trim().length > 0 && !repoOk && (
          <p className="text-xs text-warning">Enter the repo as owner/name.</p>
        )}
      </div>

      {plan.flagged.length > 0 && (
        <Admonition
          type="warning"
          title={`${plan.flagged.length} add-on${plan.flagged.length > 1 ? 's' : ''} won't come across natively`}
          description={
            <div className="flex flex-col gap-1">
              {plan.flagged.map((f) => (
                <div key={f.name}>
                  <span className="font-mono">{f.name}</span> — {f.reason}
                </div>
              ))}
              <div className="text-foreground-light">
                They keep working through the copied config vars; nothing is dropped silently.
              </div>
            </div>
          }
        />
      )}
    </div>
  )
}

/** The Vercel plan: what comes across, and — stated plainly — what will not. */
function VercelPreview({ plan, summary }: { plan: VercelPlan; summary: VercelSummary }) {
  const EFFECT_LABEL: Record<VercelPlan['notSurviving'][number]['effect'], string> = {
    dropped: 'dropped',
    degraded: 'degraded',
    manual: 'manual',
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm text-foreground">Import preview</h2>
        <p className="text-xs text-foreground-light">
          <span className="font-mono">{plan.site.name}</span> → <span className="font-mono">{plan.site.subdomain}</span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-foreground-lighter">Framework</dt>
          <dd className="text-foreground">
            {plan.build.framework || 'auto'} <span className="text-foreground-light">· {plan.build.strategy}</span>
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-foreground-lighter">Env vars</dt>
          <dd className="text-foreground">
            {summary.envTotal} total
            {summary.envNeedingManualEntry > 0 && (
              <span className="text-warning"> · {summary.envNeedingManualEntry} to re-enter by hand</span>
            )}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-foreground-lighter">Custom domains</dt>
          <dd className="text-foreground">
            {plan.domains.length > 0 ? (
              <span className="font-mono">{plan.domains.join(', ')}</span>
            ) : (
              <span className="text-foreground-light">none</span>
            )}
          </dd>
        </div>
      </dl>

      {summary.envNeedingManualEntry > 0 && (
        <Admonition
          type="note"
          title={`${summary.envNeedingManualEntry} environment variable${summary.envNeedingManualEntry > 1 ? 's' : ''} must be re-entered by hand`}
          description="Vercel does not return the values of sensitive or system variables, so they cannot be copied. Add them to the app after it is created."
        />
      )}

      {plan.notSurviving.length > 0 && (
        <Admonition
          type="warning"
          title={`${plan.notSurviving.length} thing${plan.notSurviving.length > 1 ? 's' : ''} won't survive the move as-is`}
          description={
            <div className="flex flex-col gap-1.5">
              {plan.notSurviving.map((n) => (
                <div key={n.item}>
                  <span className="text-foreground">{n.item}</span>{' '}
                  <span className="rounded bg-surface-200 px-1 text-[10px] uppercase text-foreground-lighter">
                    {EFFECT_LABEL[n.effect]}
                  </span>
                  <div className="text-foreground-light">{n.detail}</div>
                </div>
              ))}
            </div>
          }
        />
      )}
    </div>
  )
}

export default TaskclanMigrateForm
