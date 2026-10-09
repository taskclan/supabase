/**
 * /platform/organizations/{slug}: rename or delete the workspace.
 *
 * PATCH: Studio's org General settings PATCHes this Supabase-platform path.
 * Self-hosted there was no handler for the base {slug} route (only .../members,
 * .../projects, …), so the rename hit a 404 and silently did nothing: the
 * workspace was stuck on its default name. This forwards it to the engine
 * (PATCH /api/cloud/v1/orgs), which renames the caller's active org,
 * owner/admin only.
 *
 * DELETE: the Delete organization button. It answered 405 until 2026-10-09, and
 * the toast read only "API error happened while trying to communicate with the
 * server". This forwards to the engine's DELETE /api/cloud/v1/orgs/{id}, naming
 * the workspace by the id its slug resolves to among the caller's own orgs.
 * The engine lets only the owner delete. It tears down every app, or refuses
 * and changes nothing, with a reason the toast shows ("Cancel the Pro plan in
 * Billing, ...").
 *
 * The Cloud key stays on the server; the caller is forwarded under their own token.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'
import { orgForSlug } from '@/lib/taskclan/org'

const TIMEOUT_MS = 15000
/** A delete tears down every app in the workspace, several Cloudflare calls each. */
const DELETE_TIMEOUT_MS = 120000

/**
 * Fail with a message the dashboard can show.
 *
 * Studio's handleError reads `message` at the top of the body; the
 * `{ data: null, error: { message } }` shape these routes use elsewhere hides
 * it behind the generic "API error happened while trying to communicate with
 * the server". Both are sent, so either reader finds it.
 */
function fail(res: NextApiResponse, status: number, message: string) {
  return res.status(status).json({ data: null, error: { message }, message })
}

function unreachable(res: NextApiResponse, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err)
  const timedOut = /abort|timeout/i.test(detail)
  return fail(
    res,
    timedOut ? 504 : 502,
    timedOut ? 'Taskclan Cloud did not answer in time' : `could not reach Taskclan Cloud: ${detail}`
  )
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'PATCH') return rename(req, res)
  if (req.method === 'DELETE') return remove(req, res)
  res.setHeader('Allow', ['PATCH', 'DELETE'])
  return fail(res, 405, `Method ${req.method} Not Allowed`)
}

async function rename(req: NextApiRequest, res: NextApiResponse) {
  const slug = typeof req.query.slug === 'string' ? req.query.slug : ''
  const name = (req.body as { name?: unknown })?.name
  if (typeof name !== 'string' || name.trim().length < 2) {
    return fail(res, 400, 'name must be at least 2 characters')
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return fail(res, resolved.status, resolved.reason)
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return fail(res, 501, cloud.reason)

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/orgs`, {
      method: 'PATCH',
      headers: { ...authHeadersFor(caller), 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await r.json().catch(() => ({}))) as {
      org?: { id?: string; name?: string }
      error?: string
    }
    if (!r.ok) return fail(res, r.status, body.error ?? `Taskclan Cloud answered ${r.status}`)
    // Shape the response the way Studio's org-update mutation expects: onSuccess
    // reads data.slug, and refreshes its caches from the name it sent.
    return res.status(200).json({ id: body.org?.id, slug, name: body.org?.name ?? name.trim() })
  } catch (err) {
    return unreachable(res, err)
  }
}

async function remove(req: NextApiRequest, res: NextApiResponse) {
  const slug = typeof req.query.slug === 'string' ? req.query.slug : ''
  if (!slug) return fail(res, 400, 'missing org slug')

  const resolved = callerFromRequest(req)
  if (!resolved.ok) return fail(res, resolved.status, resolved.reason)
  const caller = resolved.caller
  // The shared key acts for nobody in particular, and only the owner, signed in
  // as themselves, may delete a workspace. The engine refuses it too.
  if (caller.kind === 'shared') return fail(res, 403, 'Sign in as the workspace owner to delete it.')

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return fail(res, 501, cloud.reason)

  const org = await orgForSlug(slug, caller)
  if (!org.ok) return fail(res, 502, `Taskclan Cloud did not answer: ${org.detail}`)
  // Not a member of it, or it does not exist. 404 either way, as members.ts does.
  if (!org.data) return fail(res, 404, `No organization "${slug}"`)

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/orgs/${encodeURIComponent(org.data.uuid)}`, {
      method: 'DELETE',
      headers: authHeadersFor(caller),
      signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    })
    const body = (await r.json().catch(() => ({}))) as { error?: string }
    if (!r.ok) return fail(res, r.status, body.error ?? `Taskclan Cloud answered ${r.status}`)
    return res.status(200).json({ id: org.data.id, slug: org.data.slug, name: org.data.name })
  } catch (err) {
    return unreachable(res, err)
  }
}
