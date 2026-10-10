/**
 * GET /platform/organizations/{slug}/domains/payment-methods — the workspace's
 * cards on file, so the Review step can show which card a purchase will charge.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudProxy } from '@/lib/taskclan/proxy'

export default (req: NextApiRequest, res: NextApiResponse) =>
  cloudProxy(req, res, { enginePath: '/api/cloud/v1/billing/payment-methods', methods: ['GET'] })
