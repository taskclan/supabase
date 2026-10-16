/**
 * GET  /api/taskclan/{ref}/git — what the app builds from, and what it could:
 *      its type, its linked repository (or null), the GitHub accounts its
 *      workspace holds, the accounts the caller holds elsewhere and could use
 *      here, and the repositories the workspace's accounts can reach.
 * POST /api/taskclan/{ref}/git { installationId } — use one of the caller's
 *      GitHub accounts in the app's workspace too.
 *
 * For the Deployments page's "Connect a repository". An app made empty had no
 * way to get a repository afterwards: only the new-app form could pick one, so
 * its Deploy button could only ever say "not linked to a git repo".
 *
 * Everything here acts in the APP's workspace, whichever one the request
 * names. A project page names none, or the last organisation page visited, and
 * an app in a second workspace would otherwise be shown another workspace's
 * GitHub accounts. Linking and building go through {ref}/deploy-from-repo.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest, inOrg, type Caller } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl, siteForCaller } from '@/lib/taskclan/client'

const TIMEOUT_MS = 15000

interface Account {
  installationId: number
  accountLogin: string | null
  accountType?: string | null
}

interface Repo {
  fullName: string
  defaultBranch: string
  private: boolean
  installationId: number
}

async function engine<T>(
  base: string,
  path: string,
  caller: Caller,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; body: T }> {
  const r = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...authHeadersFor(caller),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T }
}

const account = ({ installationId, accountLogin, accountType }: Account): Account => ({
  installationId,
  accountLogin: accountLogin ?? null,
  accountType: accountType ?? null,
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ error: 'method not allowed' })
  }

  const ref = typeof req.query.ref === 'string' ? req.query.ref : ''
  if (!ref) return res.status(400).json({ error: 'missing app ref' })

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.reason })
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ error: 'not_configured', detail: cloud.reason })

  try {
    const lookup = await siteForCaller(ref, caller)
    if (!lookup.ok) return res.status(502).json({ error: lookup.detail })
    const site = lookup.data
    if (!site) return res.status(404).json({ error: `no Taskclan app matches "${ref}"` })
    const inApp = site.orgId ? inOrg(caller, site.orgId) : caller

    if (req.method === 'POST') {
      const installationId = Number(
        (req.body as { installationId?: unknown } | undefined)?.installationId
      )
      if (!Number.isInteger(installationId) || installationId <= 0) {
        return res.status(400).json({ error: 'installationId is required' })
      }
      const out = await engine<Record<string, unknown>>(
        cloud.url,
        '/api/cloud/v1/git/installations',
        inApp,
        {
          method: 'POST',
          body: { installationId },
        }
      )
      return res.status(out.status).json(out.body)
    }

    // Repositories come only through accounts this workspace holds, and Cloud
    // answers an empty list straight away when it holds none, so all three
    // questions go out at once.
    const [link, accounts, repos] = await Promise.all([
      engine<{ git?: { repoFullName?: string; branch?: string | null } | null; error?: string }>(
        cloud.url,
        `/api/cloud/v1/sites/${site.id}/git`,
        inApp
      ),
      engine<{ installations?: Account[]; available?: Account[]; error?: string }>(
        cloud.url,
        '/api/cloud/v1/git/installations',
        inApp
      ),
      engine<{ repos?: Repo[]; error?: string }>(cloud.url, '/api/cloud/v1/git/repos', inApp),
    ])
    for (const [out, what] of [
      [link, "could not read the app's repository"],
      [accounts, 'could not read GitHub accounts'],
      [repos, 'could not list repositories'],
    ] as const) {
      if (out.status >= 400) return res.status(out.status).json({ error: out.body.error ?? what })
    }

    const git = link.body.git
    return res.status(200).json({
      // The engine stores anything but 'service' as static, so read it the same way.
      type: site.type === 'service' ? 'service' : 'static',
      link: git?.repoFullName ? { repo: git.repoFullName, branch: git.branch ?? null } : null,
      installations: (accounts.body.installations ?? []).map(account),
      available: (accounts.body.available ?? []).map(account),
      repos: (repos.body.repos ?? []).map(
        ({ fullName, defaultBranch, private: isPrivate, installationId }) => ({
          fullName,
          defaultBranch,
          private: isPrivate,
          installationId,
        })
      ),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'the Cloud API did not answer in time' : 'could not reach the Cloud API',
      detail,
    })
  }
}
