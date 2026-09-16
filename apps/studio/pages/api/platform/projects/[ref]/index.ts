import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { DEFAULT_PROJECT, PROJECT_REST_URL } from '@/lib/constants/api'
import { listCloudSites, taskclanConfigured } from '@/lib/taskclan/client'
import { callerFromRequest } from '@/lib/taskclan/callerContext'
import { findSiteByRef, toStudioProject } from '@/lib/taskclan/projects'
import { taskclanOrg } from '@/lib/taskclan/org'

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

  const [org, sites] = await Promise.all([taskclanOrg(caller), listCloudSites(caller)])
  if (!org.ok) {
    return res.status(502).json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }
  if (!sites.ok) {
    return res.status(502).json({ data: null, error: { message: `Taskclan Cloud did not answer: ${sites.detail}` } })
  }

  const site = findSiteByRef(sites.data, ref)
  if (!site) {
    return res.status(404).json({ data: null, error: { message: `No Taskclan app matches "${ref}"` } })
  }

  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json({
    ...toStudioProject(site, org.data.id),
    // Cloud does not hand out a Postgres connection string for an app — the
    // app owns its own database credentials. Empty rather than invented: a
    // wrong connection string would be copied into someone's terminal.
    connectionString: '',
    restUrl: PROJECT_REST_URL,
  })
}
