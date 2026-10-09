import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { DEFAULT_PROJECT, PROJECT_REST_URL } from '@/lib/constants/api'
import { siteForCaller, taskclanConfigured } from '@/lib/taskclan/client'
import { callerFromRequest } from '@/lib/taskclan/callerContext'
import { toStudioProject } from '@/lib/taskclan/projects'
import { taskclanOrgs } from '@/lib/taskclan/org'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    default:
      res.setHeader('Allow', ['GET'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

/**
 * One app.
 *
 * Upstream ignores the ref entirely and returns DEFAULT_PROJECT whatever you
 * ask for. That is fine when there is exactly one project and misleading the
 * moment there is more than one: a stale link would open a different app while
 * the URL said otherwise.
 *
 * A ref that does not match any app now 404s. Studio handles that — it shows
 * "project not found" and offers the picker — which is the honest answer for a
 * deleted app, and better than silently showing someone else's.
 */
const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json({ ...DEFAULT_PROJECT, connectionString: '', restUrl: PROJECT_REST_URL })
  }

  const ref = String(req.query.ref ?? '')
  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller

  // siteForCaller looks in every one of the caller's organisations: a project
  // page names only its ref, and this request names no organisation.
  const [orgs, found] = await Promise.all([taskclanOrgs(caller), siteForCaller(ref, caller)])
  if (!orgs.ok) {
    return res.status(502).json({ data: null, error: { message: `Taskclan Cloud did not answer: ${orgs.detail}` } })
  }
  if (!found.ok) {
    return res.status(502).json({ data: null, error: { message: `Taskclan Cloud did not answer: ${found.detail}` } })
  }
  const site = found.data
  if (!site) {
    return res.status(404).json({ data: null, error: { message: `No Taskclan app matches "${ref}"` } })
  }
  // The app's own organisation, which need not be the caller's current one:
  // Studio files the project under this id. A personal app has none.
  const org = orgs.data.orgs.find((o) => o.uuid === site.orgId) ?? orgs.data.active
  if (!org) {
    return res.status(502).json({ data: null, error: { message: 'the caller belongs to no organisation' } })
  }

  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json({
    ...toStudioProject(site, org.id),
    // Cloud does not hand out a Postgres connection string for an app — the
    // app owns its own database credentials. Empty rather than invented: a
    // wrong connection string would be copied into someone's terminal.
    connectionString: '',
    restUrl: PROJECT_REST_URL,
  })
}
