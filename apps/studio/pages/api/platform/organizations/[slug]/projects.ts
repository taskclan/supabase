/**
 * GET /platform/organizations/{slug}/projects — the org's apps, paginated.
 *
 * This is the endpoint the Projects grid actually reads. `/platform/projects`
 * was already answering from Cloud, which is why the project picker listed real
 * apps — but the grid on `/org/{slug}` uses this one, and it did not exist. The
 * request fell through to the self-hosted default and the page showed a single
 * "Default Project" card while twenty-two real apps sat behind the other
 * endpoint. Two sources of truth, one of them wrong, and only the less-visible
 * one had been fixed.
 *
 * Same three outcomes as ./../../projects/index.ts, for the same reasons: the
 * stub when Cloud is not configured, a 502 when it is configured and failing,
 * and the real list otherwise. Never the stub while real apps exist and are
 * merely unreachable.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { DEFAULT_PROJECT } from '@/lib/constants/api'
import { listCloudSites, taskclanConfigured } from '@/lib/taskclan/client'
import { callerFromRequest, inOrg } from '@/lib/taskclan/callerContext'
import { matchesSlug, taskclanOrgs } from '@/lib/taskclan/org'
import { toStudioProjects } from '@/lib/taskclan/projects'
import { applyProjectsQuery, projectsPage, readProjectsQuery } from '@/lib/taskclan/projectsPage'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res
      .status(405)
      .json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
  }
  return handleGet(req, res)
}

const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  const query = readProjectsQuery(req.query)
  const { limit, offset } = query

  if (!taskclanConfigured()) {
    res.setHeader('x-taskclan-source', 'stub')
    // `databases: []` for exactly the reason projectsPage adds it to the Cloud
    // branch below. DEFAULT_PROJECT is upstream's constant and carries
    // no `databases`, so the stub violated the same required field, and the
    // grid died on the error boundary rather than rendering one placeholder
    // card. The Cloud path was fixed when it was written; this one was missed,
    // which hid it: the crash only reaches someone with no Cloud key — a fresh
    // checkout, where "the console is broken" is the worst first impression.
    return res.status(200).json({
      projects: [{ ...DEFAULT_PROJECT, databases: [] }],
      pagination: { count: 1, limit, offset },
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

  // The slug in the path names WHICH org's apps are being asked for. This route
  // used to ignore it and answer with the caller's active org, which is right
  // for as long as there is only ever one: with several, opening /org/globex
  // lists Acme's apps under Globex's heading, and nothing about the page says
  // so. A slug the caller is not a member of is 404, not an empty list, because
  // "you have no apps here" is a different and more alarming claim.
  const slug = typeof req.query.slug === 'string' ? req.query.slug : ''
  const target = slug ? orgs.data.orgs.find((o) => matchesSlug(o, slug)) : orgs.data.active
  if (!target) {
    return res.status(404).json({ data: null, error: { message: `No organization "${slug}"` } })
  }

  const sites = await listCloudSites(inOrg(caller, target.uuid))
  if (!sites.ok) {
    console.error('[taskclan] listing apps failed: %s, %s', sites.reason, sites.detail)
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${sites.detail}` } })
  }

  const all = applyProjectsQuery(toStudioProjects(sites.data, target.id), query)

  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json(projectsPage(all, query))
}
