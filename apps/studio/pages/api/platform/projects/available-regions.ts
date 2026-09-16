/**
 * GET /platform/projects/available-regions — the regions a new project can go in.
 *
 * The stock new-project wizard asks the platform which regions are available;
 * self-hosted Studio has no such endpoint, so the request fell through and the
 * form rendered "Error loading available regions" with no region selectable.
 *
 * This answers from `shared-data`'s region table — the same source the client
 * uses for the non-smart-region path — so the two agree. Every AWS region
 * Supabase offers is returned as available (no capacity filtering: the actual
 * project is provisioned by the Taskclan engine, which places it and would
 * report a capacity failure at creation time, not here). `ca-central-1` is the
 * recommended region because that is where the engine provisions managed
 * databases by default (SUPABASE_MANAGED_REGION).
 *
 * Shape is RegionsInfo_Output: `all.smartGroup` (continent-level groups),
 * `all.specific` (individual regions), and `recommendations` for each.
 */
import { AWS_REGIONS } from 'shared-data'
import type { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'

type CloudProvider = 'AWS' | 'AWS_K8S' | 'AWS_NIMBUS'

// code -> display name, from the shared region table so names match the client.
const NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.values(AWS_REGIONS).map((r) => [r.code, r.displayName])
)

// The specific region codes RegionsInfo_Output enumerates. Kept explicit so the
// list is a deliberate set rather than whatever shared-data happens to carry.
const SPECIFIC_CODES = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ap-southeast-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-east-1',
  'ap-southeast-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-north-1',
  'eu-central-1',
  'eu-central-2',
  'ca-central-1',
  'ap-south-1',
  'sa-east-1',
] as const

const SMART_GROUPS = [
  { code: 'americas' as const, name: 'Americas', type: 'smartGroup' as const },
  { code: 'emea' as const, name: 'Europe, Middle East & Africa', type: 'smartGroup' as const },
  { code: 'apac' as const, name: 'Asia-Pacific', type: 'smartGroup' as const },
]

// Where the engine provisions managed databases by default.
const RECOMMENDED_SPECIFIC = 'ca-central-1'
const RECOMMENDED_SMART = 'americas'

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

const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  const providerParam = Array.isArray(req.query.cloud_provider)
    ? req.query.cloud_provider[0]
    : req.query.cloud_provider
  const provider: CloudProvider =
    providerParam === 'AWS_K8S' || providerParam === 'AWS_NIMBUS' ? providerParam : 'AWS'

  const specific = SPECIFIC_CODES.map((code) => ({
    code,
    name: NAME_BY_CODE[code] ?? code,
    provider,
    type: 'specific' as const,
  }))

  const recommendedSpecific = specific.find((r) => r.code === RECOMMENDED_SPECIFIC) ?? specific[0]
  const recommendedSmart =
    SMART_GROUPS.find((g) => g.code === RECOMMENDED_SMART) ?? SMART_GROUPS[0]

  return res.status(200).json({
    all: {
      smartGroup: SMART_GROUPS,
      specific,
    },
    recommendations: {
      smartGroup: recommendedSmart,
      specific: [recommendedSpecific],
    },
  })
}
