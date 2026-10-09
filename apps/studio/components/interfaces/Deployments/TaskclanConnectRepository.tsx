/**
 * Connect a repository, for an app that does not build from one yet.
 *
 * An app made empty could not get a repository afterwards: only the new-app
 * form picked one, so its Deploy button could only answer "not linked to a git
 * repo". This picks one, links it and starts the first build, through the same
 * route the form uses ({ref}/deploy-from-repo). Once the app is linked it
 * renders nothing, and the page's Deploy button takes over.
 *
 * Everything it asks is about the app's own workspace ({ref}/git), so an app
 * in a second workspace is offered that workspace's GitHub accounts, plus any
 * the person already holds elsewhere and can bring in with one click.
 *
 * GitHub opens in a new tab, and the panel looks again when the person comes
 * back to this one. A first install does return, but in the GitHub tab, as a
 * second copy of this page; a change to an existing installation's
 * repositories ends on GitHub's own settings page, with no call back at all.
 * Either way it is this tab that has to look again.
 */
import { ExternalLink, Github } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import { useGitHubReturn } from '@/hooks/misc/useGitHubReturn'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

export interface GitAccount {
  installationId: number
  accountLogin: string | null
  accountType?: string | null
}

export interface GitRepo {
  fullName: string
  defaultBranch: string
  private: boolean
  installationId: number
}

export interface GitState {
  type: 'service' | 'static'
  link: { repo: string; branch: string | null } | null
  installations: GitAccount[]
  available: GitAccount[]
  repos: GitRepo[]
}

type RunAs = GitState['type']

// Named as the new-app form names them, so the choice reads the same in both
// places. A static site is not "files with nothing behind them": a landing page
// with a waitlist still needs somewhere to keep the signups.
const RUN_AS: Record<RunAs, { label: string; hint: string }> = {
  static: {
    label: 'Static site',
    hint: 'Prebuilt files served from the edge, with no server running. It can still use a database the page talks to directly, like Supabase for a waitlist.',
  },
  service: {
    label: 'Web service',
    hint: 'A running app in a container: Next.js, Node, or anything with a start command. Choose this when code has to run on a server or keep a secret.',
  },
}

const nameOf = (a: GitAccount) => a.accountLogin ?? 'that GitHub account'

/** Where GitHub lets the account's owner choose which repositories the app can see. */
export function githubAccessUrl(a: GitAccount): string {
  return a.accountType === 'Organization' && a.accountLogin
    ? `https://github.com/organizations/${encodeURIComponent(a.accountLogin)}/settings/installations/${a.installationId}`
    : `https://github.com/settings/installations/${a.installationId}`
}

const json = async (res: Response) =>
  (await res.json().catch(() => ({}))) as { error?: string; detail?: string; url?: string }

export function TaskclanConnectRepository({
  projectRef,
  onLinkedChange,
  onDeploy,
}: {
  projectRef: string
  /** Told whether the app builds from a repository, once that is known. */
  onLinkedChange?: (linked: boolean) => void
  /** After a build was asked for, so the page can follow it. */
  onDeploy: () => void
}) {
  const [state, setState] = useState<GitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [chosenRunAs, setChosenRunAs] = useState<RunAs | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Set once GitHub has been opened in another tab: from then on, coming back
  // to this one is the cue to look again.
  const [awaitingGitHub, setAwaitingGitHub] = useState(false)

  // In the tab GitHub returns to, say how the install went. The state below is
  // read fresh on the way in, so it already shows what the install added.
  useGitHubReturn()

  const load = useCallback(async () => {
    try {
      const res = await taskclanFetch(`/api/taskclan/${projectRef}/git`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error ?? `Taskclan Cloud answered ${res.status}`)
        return
      }
      setError(null)
      setState(body as GitState)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [projectRef])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state) onLinkedChange?.(state.link !== null)
  }, [state, onLinkedChange])

  useEffect(() => {
    if (!awaitingGitHub) return
    const again = () => void load()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [awaitingGitHub, load])

  const selected = useMemo(
    () => state?.repos.find((r) => r.fullName === repo) ?? null,
    [state, repo]
  )
  // A static site can become a web service (deploy-service sets the type); a
  // web service has no way back to a static site, so only a static site is asked.
  const runAs: RunAs = chosenRunAs ?? state?.type ?? 'service'

  const installOnGitHub = async () => {
    // Opened before the request: a tab opened after an await is a popup to most
    // browsers, and they block it.
    const tab = window.open('', '_blank')
    setBusy('install')
    try {
      const res = await taskclanFetch(
        `/api/taskclan/github/connect?ref=${encodeURIComponent(projectRef)}&returnTo=${encodeURIComponent(window.location.href)}`
      )
      const body = await json(res)
      if (!res.ok || !body.url) {
        tab?.close()
        toast.error(body.error ?? 'Could not start the GitHub connection')
        return
      }
      if (tab) {
        tab.opener = null
        tab.location.href = body.url
      } else {
        window.location.href = body.url
      }
      setAwaitingGitHub(true)
    } catch (e) {
      tab?.close()
      toast.error(e instanceof Error ? e.message : 'Could not start the GitHub connection')
    } finally {
      setBusy(null)
    }
  }

  const bindAccount = async (a: GitAccount) => {
    setBusy(`account:${a.installationId}`)
    try {
      const res = await taskclanFetch(`/api/taskclan/${projectRef}/git`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installationId: a.installationId }),
      })
      const body = await json(res)
      if (!res.ok) {
        toast.error(body.error ?? `Could not use ${nameOf(a)} here`)
        return
      }
      toast.success(`${nameOf(a)} is connected to this workspace`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const connectAndDeploy = async () => {
    if (!selected) return
    setBusy('deploy')
    try {
      const res = await taskclanFetch(`/api/taskclan/${projectRef}/deploy-from-repo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repo: selected.fullName,
          branch: branch.trim() || selected.defaultBranch,
          installationId: selected.installationId,
          ...(runAs === 'static' ? { type: 'static' } : {}),
        }),
      })
      const body = await json(res)
      if (res.ok) toast.success(`Connected to ${selected.fullName}. Deploying it now.`)
      else toast.error(body.error ?? body.detail ?? `The deploy was refused (${res.status})`)
      // Either way: a refused build can still have saved the link, and a
      // failed one leaves a deployment to read.
      onDeploy()
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // Linked already, or still finding out: the page carries on without us.
  if (state?.link) return null
  if (!state && !error) return null

  const accessLinks = (accounts: GitAccount[]) =>
    accounts.map((a, i) => (
      <span key={a.installationId}>
        {i > 0 && ', '}
        <a
          href={githubAccessUrl(a)}
          target="_blank"
          rel="noreferrer"
          onClick={() => setAwaitingGitHub(true)}
          className="inline-flex items-center gap-1 text-foreground-light underline underline-offset-2 hover:text-foreground"
        >
          {nameOf(a)}
          <ExternalLink size={12} />
        </a>
      </span>
    ))

  return (
    <section
      aria-label="Connect a repository"
      className="mb-6 flex flex-col gap-4 rounded-md border border-default bg-surface-100 px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm text-foreground">
            <Github size={15} /> Connect a repository
          </h3>
          <p className="mt-1 text-sm text-foreground-lighter">
            This app doesn&apos;t build from a repository yet. Pick one and it deploys now; after
            that, Deploy rebuilds it.
          </p>
        </div>
        {awaitingGitHub && (
          <Button variant="default" onClick={() => void load()}>
            Check again
          </Button>
        )}
      </div>

      {error && (
        <Admonition type="warning" title="Could not read GitHub for this app">
          <p className="text-sm">{error}</p>
          <Button variant="default" className="mt-2" onClick={() => void load()}>
            Try again
          </Button>
        </Admonition>
      )}

      {state && state.installations.length === 0 && state.available.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-foreground-light">
            No GitHub account is connected to this workspace. Install the Taskclan Cloud GitHub App
            on the account that owns the repository. GitHub opens in a new tab; come back here when
            you&apos;re done.
          </p>
          <Button
            variant="default"
            icon={<Github size={14} />}
            loading={busy === 'install'}
            disabled={busy !== null}
            onClick={() => void installOnGitHub()}
          >
            Install on GitHub
          </Button>
        </div>
      )}

      {state && state.available.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground-light">
            {state.installations.length === 0
              ? 'No GitHub account is connected to this workspace yet, but you already use these in another one:'
              : 'You also use these GitHub accounts in another workspace:'}
          </p>
          <div className="flex flex-wrap gap-2">
            {state.available.map((a) => (
              <Button
                key={a.installationId}
                variant="default"
                icon={<Github size={14} />}
                loading={busy === `account:${a.installationId}`}
                disabled={busy !== null}
                onClick={() => void bindAccount(a)}
              >
                Use {nameOf(a)} here
              </Button>
            ))}
          </div>
        </div>
      )}

      {state && state.installations.length > 0 && state.repos.length === 0 && (
        <p className="text-sm text-foreground-light">
          The Taskclan Cloud GitHub App can&apos;t see any repositories yet. Choose the ones it can
          see on GitHub, then come back here: {accessLinks(state.installations)}
        </p>
      )}

      {state && state.repos.length > 0 && (
        <div className="flex max-w-xl flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-foreground-light" htmlFor="tc-connect-repo">
              Repository
            </label>
            <Select
              value={repo}
              onValueChange={(v) => {
                setRepo(v)
                setBranch(state.repos.find((r) => r.fullName === v)?.defaultBranch ?? '')
              }}
            >
              <SelectTrigger id="tc-connect-repo">
                <SelectValue placeholder="Select a repository…" />
              </SelectTrigger>
              <SelectContent>
                {state.repos.map((r) => (
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
            <p className="text-xs text-foreground-lighter">
              Not listed? Choose which repositories the app can see on GitHub for{' '}
              {accessLinks(state.installations)}, or{' '}
              <button
                type="button"
                tabIndex={busy !== null ? -1 : 0}
                className="text-foreground-light underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => void installOnGitHub()}
              >
                install it on another account
              </button>
              .
            </p>
          </div>

          {selected && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-foreground-light" htmlFor="tc-connect-branch">
                  Branch
                </label>
                <Input
                  id="tc-connect-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder={selected.defaultBranch}
                />
              </div>

              {state.type === 'static' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-foreground-light" htmlFor="tc-connect-run-as">
                    Run it as
                  </label>
                  <Select value={runAs} onValueChange={(v) => setChosenRunAs(v as RunAs)}>
                    <SelectTrigger id="tc-connect-run-as">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['static', 'service'] as const).map((k) => (
                        <SelectItem key={k} value={k}>
                          {RUN_AS[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-foreground-lighter">{RUN_AS[runAs].hint}</p>
                </div>
              )}

              <Button
                variant="primary"
                className="self-start"
                loading={busy === 'deploy'}
                disabled={busy !== null}
                onClick={() => void connectAndDeploy()}
              >
                Connect and deploy
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
