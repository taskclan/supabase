import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl, taskclanConfigured } from '@/lib/taskclan/client'
import { taskclanOrgs, type TaskclanOrg } from '@/lib/taskclan/org'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGetAll(req, res)
    case 'POST':
      return handleCreate(req, res)
    default:
      res.setHeader('Allow', ['GET', 'POST'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const STUB_ORG = {
  id: 1,
  name: process.env.DEFAULT_ORGANIZATION_NAME || 'Default Organization',
  slug: 'default-org-slug',
  billing_email: 'billing@supabase.co',
  plan: { id: 'enterprise', name: 'Enterprise' },
}

/**
 * The org behind the configured Cloud API key.
 *
 * `id` comes from taskclanOrg() rather than being computed here, because the
 * projects handler compares its `organization_id` against this number. Two
 * derivations of the same thing would not error — they would render an org
 * with no apps and apps belonging to nothing.
 *
 * Every org the caller belongs to, not one. An sk_cloud_* key still resolves
 * to exactly one, so the shared-key path is unchanged; a signed-in person can
 * belong to several, and the switcher needs them all to switch between.
 */
const handleGetAll = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json([STUB_ORG])
  }

  const caller = callerFromRequest(req)
  if (!caller.ok) {
    return res.status(caller.status).json({ data: null, error: { message: caller.reason } })
  }

  const result = await taskclanOrgs(caller.caller)
  if (!result.ok) {
    console.error('[taskclan] resolving orgs failed: %s, %s', result.reason, result.detail)
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${result.detail}` } })
  }

  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json(result.data.orgs.map(toStudioOrganization))
}

/** A Cloud org in the shape Studio's organization list reads, for the list and for a new one alike. */
function toStudioOrganization(org: TaskclanOrg) {
  return {
    id: org.id,
    name: org.name,
    // The engine's own slug, carried rather than re-derived. It generates it
    // with a uniqueness loop; deriving one from the name here would give two
    // orgs called "Acme" the same slug, and Studio routes org URLs on it.
    slug: org.slug,
    // Cloud does not expose a billing email here. Left null rather than
    // faked: Studio renders these read-only, and an invented address is the
    // kind of thing someone would try to send an invoice to.
    billing_email: null,
    // The name is Cloud's real tier, so the console stops telling a Pro
    // customer they are on Enterprise.
    //
    // The id stays pinned, and that is deliberate rather than an oversight.
    // Studio reads it to decide which of Supabase's paywalls and upgrade
    // prompts to show, and those gate Supabase's products against Supabase's
    // tiers. Taskclan's tiers mean something else entirely, so mapping
    // "pro" onto Supabase's "pro" would start nagging a paying customer to
    // upgrade to a plan that does not exist here. The id is never shown; the
    // name is.
    plan: { id: 'enterprise', name: `${org.plan.charAt(0).toUpperCase()}${org.plan.slice(1)}` },
  }
}

const CREATE_TIMEOUT_MS = 15000

/**
 * POST: create an organization, a Taskclan workspace, with the caller as owner.
 *
 * Studio's New organization form posts here, and this route used to answer 405:
 * creating an organization from the console had never worked. Only the name is
 * Cloud's to take. The form also sends `kind` and `size` (a survey), plus a
 * Supabase tier and card that Taskclan has no use for. A workspace starts free,
 * and its plan is chosen in its Billing page.
 *
 * Answers in the list's shape, read back from the list itself, because Studio
 * appends it to its cached list and the numeric id has to be the one GET will
 * give the same org (assignNumericIds resolves collisions across the set).
 */
const handleCreate = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!taskclanConfigured()) {
    return res
      .status(501)
      .json({ data: null, error: { message: 'Taskclan Cloud is not configured on this console' } })
  }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (name.length < 2) {
    return res
      .status(400)
      .json({ data: null, error: { message: 'An organization name needs at least 2 characters.' } })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller
  // The shared key belongs to whoever minted it; an organization made with it
  // would be theirs, not the visitor's.
  if (caller.kind === 'shared') {
    return res
      .status(403)
      .json({ data: null, error: { message: 'Sign in to create an organization.' } })
  }

  const cloud = cloudBaseUrl()
  if (!cloud.ok) return res.status(501).json({ data: null, error: { message: cloud.reason } })

  let created: { id?: string; slug?: string } | undefined
  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/orgs`, {
      method: 'POST',
      headers: { ...authHeadersFor(caller), 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
    })
    const body = (await r.json().catch(() => ({}))) as { org?: { id?: string; slug?: string }; error?: string }
    if (!r.ok || !body.org?.id) {
      return res.status(r.ok ? 502 : r.status).json({
        data: null,
        error: { message: body.error ?? `Taskclan Cloud answered ${r.status}` },
      })
    }
    created = body.org
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const timedOut = /abort|timeout/i.test(detail)
    return res.status(timedOut ? 504 : 502).json({
      data: null,
      error: { message: timedOut ? 'Taskclan Cloud did not answer in time' : `could not reach Taskclan Cloud: ${detail}` },
    })
  }

  const listed = await taskclanOrgs(caller)
  const org = listed.ok ? listed.data.orgs.find((o) => o.uuid === created?.id) : undefined
  if (!org) {
    // Made, but not readable back yet. Say so rather than inventing an id the
    // list would contradict a moment later.
    return res.status(502).json({
      data: null,
      error: { message: 'The organization was created, but could not be read back. Reload to see it.' },
    })
  }
  return res.status(201).json(toStudioOrganization(org))
}
