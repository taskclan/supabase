import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { taskclanConfigured, taskclanMultiTenant } from '@/lib/taskclan/client'
import { taskclanOrg, userOrgs } from '@/lib/taskclan/org'

/** The caller's bearer token, forwarded to the engine so actions are theirs. */
function bearerToken(req: NextApiRequest): string {
  const h = req.headers.authorization
  return (Array.isArray(h) ? h[0] : h)?.trim() ?? ''
}

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
const handleGetAll = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json([STUB_ORG])
  }

  // Multi-tenant: return the SIGNED-IN USER's orgs (each with their role),
  // resolved from their own token by the engine. Falls through to the
  // single-key org when the token path isn't available, so the console keeps
  // working while multi-tenant auth is being wired up.
  const token = bearerToken(req)
  if (taskclanMultiTenant() && token) {
    const orgs = await userOrgs(token)
    if (orgs.ok) {
      res.setHeader('x-taskclan-source', 'cloud-user')
      return res.status(200).json(
        orgs.data.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          role: o.role,
          billing_email: null,
          plan: { id: 'enterprise', name: 'Taskclan Cloud' },
        }))
      )
    }
    // Token present but the engine wouldn't honour it (e.g. the console's auth
    // isn't pointed at the engine's identity yet). Log and fall back rather
    // than 502, so the single-org view still renders.
    console.warn('[taskclan] multi-tenant org list failed, falling back to the key org: %s — %s', orgs.reason, orgs.detail)
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
