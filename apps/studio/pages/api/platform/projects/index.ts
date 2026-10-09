import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { DEFAULT_PROJECT } from '@/lib/constants/api'
import { createCloudSite, listCloudSites, taskclanConfigured } from '@/lib/taskclan/client'
import { callerFromRequest, inOrg } from '@/lib/taskclan/callerContext'
import { toStudioProject, toStudioProjects } from '@/lib/taskclan/projects'
import { taskclanOrg, taskclanOrgs } from '@/lib/taskclan/org'
import { applyProjectsQuery, projectsPage, readProjectsQuery } from '@/lib/taskclan/projectsPage'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      // Version 2 is the paginated list every useProjectsInfiniteQuery reads;
      // the bare list is what anything older still gets.
      return req.headers.version === '2' ? handleGetPage(req, res) : handleGetAll(req, res)
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

  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller

  const [org, created] = await Promise.all([
    taskclanOrg(caller),
    createCloudSite({ name, type }, caller),
  ])
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
const handleGetAll = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json([DEFAULT_PROJECT])
  }

  // Both in parallel: the org id has to come from the same place the
  // organizations handler reads it, or Studio cannot match an app to its org.
  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller

  const [org, result] = await Promise.all([taskclanOrg(caller), listCloudSites(caller)])
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

/**
 * One page of every app the caller can reach, across all their organisations
 * (Version 2: `{ projects, pagination }`).
 *
 * Studio's useProjectsInfiniteQuery asks for this, and every consumer flattens
 * `pages.flatMap((page) => page.projects)`. This route answered with the bare
 * list regardless, so `page.projects` was undefined and each consumer got one
 * `undefined` project. The command menu destructured it ("Cannot destructure
 * property 'name' of 'undefined'") and took the New organization page down.
 *
 * Every organisation, not the active one: the command menu switches between
 * all of them, and the New organization form looks for free organisations
 * that already have projects (by `organization_slug`). A shared key has one
 * organisation, its own, so it lists just that one rather than the same apps
 * once per organisation of its minter.
 */
const handleGetPage = async (req: NextApiRequest, res: NextApiResponse) => {
  const query = readProjectsQuery(req.query)

  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json({
      projects: [{ ...DEFAULT_PROJECT, databases: [] }],
      pagination: { count: 1, limit: query.limit, offset: query.offset },
    })
  }

  const resolved = callerFromRequest(req)
  if (!resolved.ok) {
    return res.status(resolved.status).json({ data: null, error: { message: resolved.reason } })
  }
  const caller = resolved.caller

  const orgs = await taskclanOrgs(caller)
  if (!orgs.ok) {
    console.error('[taskclan] resolving orgs failed: %s, %s', orgs.reason, orgs.detail)
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${orgs.detail}` } })
  }
  const targets =
    caller.kind === 'shared'
      ? [orgs.data.active].filter((o): o is NonNullable<typeof o> => o != null)
      : orgs.data.orgs

  const listed = await Promise.all(
    targets.map(async (org) => ({ org, sites: await listCloudSites(inOrg(caller, org.uuid)) }))
  )
  const failed = listed.find((l) => !l.sites.ok)
  if (failed && !failed.sites.ok) {
    console.error('[taskclan] listing apps failed: %s, %s', failed.sites.reason, failed.sites.detail)
    return res.status(502).json({
      data: null,
      error: { message: `Taskclan Cloud did not answer: ${failed.sites.detail}` },
    })
  }

  const all = applyProjectsQuery(
    listed.flatMap(({ org, sites }) =>
      sites.ok
        ? toStudioProjects(sites.data, org.id).map((p) => ({ ...p, organization_slug: org.slug }))
        : []
    ),
    query
  )
  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json(projectsPage(all, query))
}
