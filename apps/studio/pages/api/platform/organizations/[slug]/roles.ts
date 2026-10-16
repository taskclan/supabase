/**
 * GET /platform/organizations/{slug}/roles — the roles this org can assign.
 *
 * Cloud has three, fixed by a CHECK constraint on cloud_org_members, so this
 * returns them rather than proxying: there is nothing upstream to ask, and a
 * round trip to learn a constant would only add a way for the page to fail.
 *
 * `project_scoped_roles` is empty because Cloud has no per-app roles. Studio
 * reads the two lists separately and renders nothing for an empty one, which is
 * the correct outcome: an empty list says "this does not exist here", where
 * copying the org roles into it would offer a per-app permission that the
 * backend would ignore.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { callerFromRequest } from '@/lib/taskclan/callerContext'
import { orgForSlug, TASKCLAN_ROLES } from '@/lib/taskclan/org'

function organizationRolesRoute(req: NextApiRequest, res: NextApiResponse) {
  return apiWrapper(req, res, handler)
}

export default organizationRolesRoute

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

  // The list is a constant, but membership still gates it: which roles an
  // organisation uses is its own business, and this is also what makes a slug
  // that is not the caller's answer 404 here as it does everywhere else.
  const org = await orgForSlug(slug, resolved.caller)
  if (!org.ok) {
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }
  if (!org.data) {
    return res.status(404).json({ data: null, error: { message: `No organization "${slug}"` } })
  }

  return res.status(200).json({
    org_scoped_roles: TASKCLAN_ROLES.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      base_role_id: role.id,
      projects: [],
    })),
    project_scoped_roles: [],
  })
}
