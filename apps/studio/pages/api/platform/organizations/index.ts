import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { callerFromRequest } from '@/lib/taskclan/callerContext'
import { taskclanConfigured } from '@/lib/taskclan/client'
import { taskclanOrgs } from '@/lib/taskclan/org'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGetAll(req, res)
    default:
      res.setHeader('Allow', ['GET'])
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
  return res.status(200).json(
    result.data.orgs.map((org) => ({
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
    }))
  )
}
