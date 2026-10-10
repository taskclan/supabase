/**
 * GET /platform/organizations/{slug}/domains/apps — the workspace's apps with
 * their real ids, for the "connect to" picker. A domain is registered against
 * a site id, which the Studio project shape doesn't carry.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudProxy } from '@/lib/taskclan/proxy'

export default (req: NextApiRequest, res: NextApiResponse) =>
  cloudProxy(req, res, { enginePath: '/api/cloud/v1/sites', methods: ['GET'] })
