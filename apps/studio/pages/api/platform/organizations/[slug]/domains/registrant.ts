/**
 * GET/POST /platform/organizations/{slug}/domains/registrant — the workspace's
 * registrant contact (the customer owns the domain). The POST relays the
 * engine's field-level validation (`missing`) unchanged.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { cloudProxy } from '@/lib/taskclan/proxy'

export default (req: NextApiRequest, res: NextApiResponse) =>
  cloudProxy(req, res, { enginePath: '/api/cloud/v1/domains/registrant', methods: ['GET', 'POST'] })
