/**
 * GET /platform/organizations/{slug}/members/invitations — pending invitations.
 *
 * Always empty, and that is a statement about Cloud rather than a stub. Its
 * invite flow adds the member row immediately: `POST /orgs/{id}/members` looks
 * the person up by email and joins them, so there is no pending state for an
 * invitation to sit in and nothing to list.
 *
 * The endpoint exists because the members query fetches it alongside the member
 * list and fails the whole page if either request errors. Answering honestly
 * with none beats 404ing a concept this product does not have.
 *
 * If Cloud grows real invitations (a row that exists before the person accepts),
 * this is where they surface, and the shape is already the one Studio expects.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { callerFromRequest } from '@/lib/taskclan/callerContext'
import { orgForSlug } from '@/lib/taskclan/org'

function organizationInvitationsRoute(req: NextApiRequest, res: NextApiResponse) {
  return apiWrapper(req, res, handler)
}

export default organizationInvitationsRoute

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

  const org = await orgForSlug(slug, resolved.caller)
  if (!org.ok) {
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }
  if (!org.data) {
    return res.status(404).json({ data: null, error: { message: `No organization "${slug}"` } })
  }

  return res.status(200).json({ invitations: [] })
}
