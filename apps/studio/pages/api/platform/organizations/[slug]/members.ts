/**
 * GET /platform/organizations/{slug}/members — who is in this organisation.
 *
 * The Team page read upstream's endpoint, which this build does not serve, so
 * it rendered two red panels saying the API could not be reached. The people
 * are real and Cloud has always known them; nothing was surfacing them.
 *
 * Shapes Cloud's members into `Member_Output`, which Studio types as required
 * fields. Where Cloud has no equivalent the answer is the honest empty one
 * rather than a plausible-looking invention: no avatars, and `mfa_enabled`
 * false because Cloud does not track MFA, not because anybody has it off.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { authHeadersFor, callerFromRequest } from '@/lib/taskclan/callerContext'
import { cloudBaseUrl } from '@/lib/taskclan/client'
import { orgForSlug, roleIdFor } from '@/lib/taskclan/org'

function organizationMembersRoute(req: NextApiRequest, res: NextApiResponse) {
  return apiWrapper(req, res, handler)
}

export default organizationMembersRoute

const TIMEOUT_MS = 15000

interface CloudMember {
  userId: string
  role: string
  createdAt?: string
  name?: string | null
  email?: string | null
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res
      .status(405)
      .json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
  }

  const slug = typeof req.query.slug === 'string' ? req.query.slug : ''
  if (!slug) return res.status(400).json({ data: null, error: { message: 'missing org slug' } })

  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller

  const cloud = cloudBaseUrl()
  if (!cloud.ok) {
    return res.status(501).json({ data: null, error: { message: cloud.reason } })
  }

  const org = await orgForSlug(slug, caller)
  if (!org.ok) {
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }
  // Not a member of it, or it does not exist. 404 either way: telling somebody
  // an org exists but is not theirs is not information they are owed.
  if (!org.data) {
    return res.status(404).json({ data: null, error: { message: `No organization "${slug}"` } })
  }

  try {
    const r = await fetch(`${cloud.url}/api/cloud/v1/orgs/${org.data.uuid}/members`, {
      headers: authHeadersFor(caller),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) {
      return res
        .status(r.status === 403 ? 403 : 502)
        .json({ data: null, error: { message: `Taskclan Cloud answered ${r.status}` } })
    }

    const body = (await r.json()) as { members?: CloudMember[] }
    const members = Array.isArray(body.members) ? body.members : []

    return res.status(200).json(
      members.map((m) => ({
        gotrue_id: m.userId,
        primary_email: m.email ?? null,
        // Studio shows `username` as the display name and takes its avatar
        // initial from it, so an empty string renders a blank chip. Fall back
        // through what Cloud actually knows rather than inventing a name.
        username: m.name || m.email?.split('@')[0] || m.userId.slice(0, 8),
        role_ids: [roleIdFor(m.role)],
        avatar_url: null,
        // Cloud tracks neither. False and empty are the truthful answers, and
        // both are what Studio renders as "nothing to say".
        is_sso_user: false,
        mfa_enabled: false,
        metadata: {},
      }))
    )
  } catch (e) {
    return res.status(502).json({
      data: null,
      error: { message: e instanceof Error ? e.message : 'could not reach Taskclan Cloud' },
    })
  }
}
