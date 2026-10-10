/**
 * GET /platform/organizations/{slug}/domains/search?q=&limit= — buyable domains
 * + resale prices, as the signed-in user, proxied to the engine.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudProxy } from '@/lib/taskclan/proxy'

export default (req: NextApiRequest, res: NextApiResponse) =>
  cloudProxy(req, res, { enginePath: '/api/cloud/v1/domains/search', methods: ['GET'] })
