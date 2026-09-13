import { NextApiRequest, NextApiResponse } from 'next'

import { constructHeaders } from '@/lib/api/apiHelpers'
import { apiWrapper } from '@/lib/api/apiWrapper'
import { executeQuery } from '@/lib/api/self-hosted/query'
import { PgMetaDatabaseError } from '@/lib/api/self-hosted/types'

export default (req: NextApiRequest, res: NextApiResponse) =>
  apiWrapper(req, res, handler, { withAuth: true })

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'POST':
      return handlePost(req, res)
    default:
      res.setHeader('Allow', ['POST'])
      res.status(405).json({ error: { message: `Method ${method} Not Allowed` } })
  }
}

const handlePost = async (req: NextApiRequest, res: NextApiResponse) => {
  const { query } = req.body
  const headers = constructHeaders(req.headers)
  // `ref` names the app whose database this query is for. It is in the route
  // path — /api/platform/pg-meta/[ref]/query — and dropping it here is not a
  // no-op: executeQuery then falls back to the process-wide connection, so the
  // SQL editor for EVERY app queries the shared database, including the one
  // holding cloud_api_keys. Proven before this line existed: pg-meta logged
  // `"pg":"db"` (the compose default) for a forge3d query.
  const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
  const { data, error } = await executeQuery({ query, headers, ref })

  if (error) {
    if (error instanceof PgMetaDatabaseError) {
      const { statusCode, message, formattedError } = error
      return res.status(statusCode).json({ message, formattedError })
    }
    const { message } = error
    return res.status(500).json({ message, formattedError: message })
  } else {
    return res.status(200).json(data)
  }
}
