import { NextApiRequest, NextApiResponse } from 'next'

import { constructHeaders } from '@/lib/api/apiHelpers'
import { apiWrapper } from '@/lib/api/apiWrapper'
import { DEFAULT_EXPOSED_SCHEMAS } from '@/lib/api/self-hosted/constants'
import { getLints } from '@/lib/api/self-hosted/lints'
import { callerFromRequest } from '@/lib/taskclan/callerContext'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET': {
      const caller = callerFromRequest(req)
      if (!caller.ok) {
        return res.status(caller.status).json({ data: null, error: { message: caller.reason } })
      }

      const { data, error } = await getLints({
        headers: constructHeaders(req.headers),
        exposedSchemas: DEFAULT_EXPOSED_SCHEMAS,
        // Lint the app's own database via its scoped role, not the process-wide
        // connection (which on a shared database is the wrong target).
        ref: typeof req.query.ref === 'string' ? req.query.ref : undefined,
        caller: caller.caller,
      })

      if (error) {
        return res.status(400).json(error)
      } else {
        return res.status(200).json(data)
      }
    }
    default:
      res.setHeader('Allow', ['GET'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}
