/**
 * POST /platform/organizations/{slug}/domains/register { domain, siteId } — buy
 * a domain and attach it to an app. The engine charges the workspace's default
 * card, registers at Cloudflare, and refunds if the registry doesn't confirm.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudProxy } from '@/lib/taskclan/proxy'

export default (req: NextApiRequest, res: NextApiResponse) =>
  cloudProxy(req, res, { enginePath: '/api/cloud/v1/domains/register', methods: ['POST'] })
