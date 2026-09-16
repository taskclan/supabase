import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { DEFAULT_PROJECT } from '@/lib/constants/api'
import { createCloudSite, listCloudSites, taskclanConfigured } from '@/lib/taskclan/client'
import { toStudioProject, toStudioProjects } from '@/lib/taskclan/projects'
import { taskclanOrg } from '@/lib/taskclan/org'

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

/**
 * Create a new app (an empty site).
 *
 * The console's native new-project form posts here for the "start empty" path;
 * the GitHub-import path goes to ./import instead, and a dedicated database is
 * provisioned afterwards against the returned ref. Returns the created project
 * in Studio's shape so the caller can route straight to `/project/{ref}`.
 *
 * Not configured is a 501 rather than the read path's silent stub: creating an
 * app with no Cloud behind it cannot half-work, and a stub row the user then
 * cannot open is worse than a clear "this console has no Cloud configured".
 */
const handleCreate = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!taskclanConfigured()) {
    return res
      .status(501)
      .json({ data: null, error: { message: 'Taskclan Cloud is not configured on this console' } })
  }

  const body = (req.body ?? {}) as { name?: unknown; type?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return res.status(400).json({ data: null, error: { message: 'A project name is required' } })
  }
  const type = body.type === 'static' ? 'static' : 'service'

  const [org, created] = await Promise.all([taskclanOrg(), createCloudSite({ name, type })])
  if (!org.ok) {
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }
  if (!created.ok) {
    // The engine's own refusal (name taken, role, timeout) passes through.
    const status = created.reason === 'not_configured' ? 501 : 502
    return res.status(status).json({ data: null, error: { message: created.detail } })
  }

  return res.status(201).json(toStudioProject(created.data, org.data.id))
}

/**
 * The org's apps, from Taskclan Cloud.
 *
 * Upstream returns `[DEFAULT_PROJECT]`, one hardcoded row. This asks Cloud
 * instead, so the project picker lists real apps.
 *
 * Three outcomes, kept distinct on purpose:
 *
 *  - Not configured: the upstream stub, plus a header saying so. Someone
 *    running the fork without Cloud credentials should still get a working
 *    dashboard, but "Default Project" must not look like an answer.
 *  - Configured and failing: 502 with the reason. Falling back to the stub
 *    here would show one fake app while the real ones existed and were simply
 *    unreachable, which is the worst of the three.
 *  - Working: the real list.
 */
const handleGetAll = async (_req: NextApiRequest, res: NextApiResponse) => {
  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json([DEFAULT_PROJECT])
  }

  // Both in parallel: the org id has to come from the same place the
  // organizations handler reads it, or Studio cannot match an app to its org.
  const [org, result] = await Promise.all([taskclanOrg(), listCloudSites()])
  if (!org.ok) {
    console.error('[taskclan] resolving the org failed: %s — %s', org.reason, org.detail)
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }
  if (!result.ok) {
    console.error('[taskclan] listing apps failed: %s — %s', result.reason, result.detail)
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${result.detail}` } })
  }

  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json(toStudioProjects(result.data, org.data.id))
}
