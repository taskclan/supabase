/**
 * GET /platform/profile — who is signed in.
 *
 * Upstream's self-hosted build answers with a fixed John Doe and one invented
 * organisation, which is honest enough when there is no concept of a user: the
 * console is single tenant and nobody is being misrepresented. It stops being
 * honest the moment people sign in. Two things go wrong, neither of them
 * cosmetic:
 *
 *   - `useLastVisitedOrganization` keys localStorage on `profile.id`. A constant
 *     id means every user on a shared browser profile inherits the last one's
 *     organisation.
 *   - The account menu shows the email. Showing somebody else's name to a
 *     paying customer reads as "this console has my data mixed up", which is
 *     the impression worth avoiding most.
 *
 * So a signed-in caller gets their own identity and their own organisations,
 * and only a caller with no session still sees the stub.
 */
import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { DEFAULT_PROJECT } from '@/lib/constants/api'
import { callerFromRequest, identityFromToken } from '@/lib/taskclan/callerContext'
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

/** Upstream's fixed answer, for a console nobody has signed in to. */
const STUB_PROFILE = {
  id: 1,
  primary_email: 'johndoe@supabase.io',
  username: 'johndoe',
  first_name: 'John',
  last_name: 'Doe',
  organizations: [
    {
      id: 1,
      name: process.env.DEFAULT_ORGANIZATION_NAME || 'Default Organization',
      slug: 'default-org-slug',
      billing_email: 'billing@supabase.co',
      projects: [{ ...DEFAULT_PROJECT, connectionString: '' }],
    },
  ],
}

/** Studio types the profile id as a number; the real one is a uuid. */
function numericProfileId(uuid: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < uuid.length; i += 1) {
    h ^= uuid.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) || 1
}

const handleGetAll = async (req: NextApiRequest, res: NextApiResponse) => {
  const resolved = callerFromRequest(req)
  if (!resolved.ok || resolved.caller.kind !== 'user') {
    // No session: the shared key has no person behind it, so there is no
    // identity to report and the stub is the truthful answer.
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json(STUB_PROFILE)
  }

  const identity = identityFromToken(resolved.caller.token)
  if (!identity) {
    res.setHeader('x-taskclan-source', 'stub')
    return res.status(200).json(STUB_PROFILE)
  }

  // Asking Cloud is what makes the decoded identity trustworthy. The claims
  // above are read without checking the signature, so on their own they are
  // only a claim; a forged token fails here, because the engine verifies it
  // before answering. A success means the token is genuine and these are its
  // real claims.
  const orgs = await taskclanOrgs(resolved.caller)
  if (!orgs.ok) {
    return res
      .status(502)
      .json({ data: null, error: { message: `Taskclan Cloud did not answer: ${orgs.detail}` } })
  }

  const email = identity.email
  res.setHeader('x-taskclan-source', 'cloud')
  return res.status(200).json({
    id: numericProfileId(identity.id),
    gotrue_id: identity.id,
    primary_email: email,
    // Cloud holds no display name, so the local part of the address stands in.
    // Inventing a first and last name would put words in someone's mouth on
    // every screen that greets them.
    username: email ? email.split('@')[0] : identity.id,
    first_name: '',
    last_name: '',
    organizations: orgs.data.orgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      billing_email: null,
      // Deliberately empty. Studio fetches an org's projects from
      // /organizations/{slug}/projects; embedding a copy here would be a second
      // source of the same list, free to disagree with the first.
      projects: [],
    })),
  })
}
