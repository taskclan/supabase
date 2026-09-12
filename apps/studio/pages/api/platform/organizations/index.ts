import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { taskclanConfigured } from '@/lib/taskclan/client'
import { taskclanOrg } from '@/lib/taskclan/org'

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
 * Only ever one org: an sk_cloud_* key resolves to exactly one. Studio copes
 * with a single-org list (it is what self-hosted mode has always returned) and
 * the switcher simply has nothing to switch to.
 */
const handleGetAll = async (_req: NextApiRequest, res: NextApiResponse) => {
  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json([STUB_ORG])
  }

  const org = await taskclanOrg()
  if (!org.ok) {
    console.error('[taskclan] resolving the org failed: %s — %s', org.reason, org.detail)
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }

  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json([
    {
      id: org.data.id,
      name: org.data.name,
      // Studio routes org URLs on the slug, so it has to be URL-safe. Derived
      // from the name rather than carried, since Cloud has no slug column.
      slug: org.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'taskclan',
      // Cloud bills in credits against its own ledger, not per-org plans, and
      // it does not expose a billing email here. Left null rather than faked:
      // Studio renders these read-only, and an invented address is the kind of
      // thing someone would try to send an invoice to.
      billing_email: null,
      plan: { id: 'enterprise', name: 'Taskclan Cloud' },
    },
  ])
}
