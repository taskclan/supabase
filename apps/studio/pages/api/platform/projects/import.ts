/**
 * POST /platform/projects/import — create an app from a GitHub repo.
 *
 * The "Import from GitHub" path of the console's native new-project form. It
 * calls Cloud's import (which creates the site, links the repo, and kicks off a
 * build) and then resolves the new site's subdomain so the caller can route to
 * `/project/{ref}` — the import result carries the site id, and Studio routes
 * on the subdomain.
 *
 * Database is deliberately NOT provisioned here (dbMode 'connect'): if the user
 * asked for a dedicated database, the form provisions it afterwards against the
 * returned ref, so the empty-app and GitHub paths share one provisioning path
 * with one tier selector.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { importCloudApp, listCloudSites, taskclanConfigured } from '@/lib/taskclan/client'
import { callerFromRequest } from '@/lib/taskclan/callerContext'
import { toStudioProject } from '@/lib/taskclan/projects'
import { taskclanOrg } from '@/lib/taskclan/org'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res
      .status(405)
      .json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
  }

  if (!taskclanConfigured()) {
    return res
      .status(501)
      .json({ data: null, error: { message: 'Taskclan Cloud is not configured on this console' } })
  }

  const body = (req.body ?? {}) as { repo?: unknown; name?: unknown; branch?: unknown }
  const repo = typeof body.repo === 'string' ? body.repo.trim() : ''
  // owner/name — the same shape the engine validates, checked here too so an
  // obvious mistake is a 400 with a clear message rather than an engine 400.
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, ''))) {
    return res
      .status(400)
      .json({ data: null, error: { message: 'Choose a repository (owner/name) to import' } })
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined
  const branch = typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : undefined

  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller

  const imported = await importCloudApp({ repo, name, branch }, caller)
  if (!imported.ok) {
    const status = imported.reason === 'not_configured' ? 501 : 502
    return res.status(status).json({ data: null, error: { message: imported.detail } })
  }

  const [org, sites] = await Promise.all([taskclanOrg(caller), listCloudSites(caller)])
  if (!org.ok) {
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${org.detail}` } })
  }
  // The site exists even if this decorating lookup fails; fall back to the id so
  // the caller still gets a routable ref rather than an error after a real create.
  const site =
    (sites.ok ? sites.data.find((s) => s.id === imported.data.siteId) : undefined) ??
    ({ id: imported.data.siteId, name: name ?? repo.split('/')[1] } as any)

  return res.status(201).json(toStudioProject(site, org.data.id))
}
