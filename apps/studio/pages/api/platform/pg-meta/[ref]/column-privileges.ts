import { NextApiRequest, NextApiResponse } from 'next'

import { getPgMetaRedirectUrl } from './tables'
import { fetchGet } from '@/data/fetchers'
import { apiWrapper } from '@/lib/api/apiWrapper'
import { pgMetaError } from '@/lib/api/self-hosted/pgMetaError'
import { pgMetaHeaders } from '@/lib/api/self-hosted/util'
import { PG_META_URL } from '@/lib/constants'

export default (req: NextApiRequest, res: NextApiResponse) =>
  apiWrapper(req, res, handler, { withAuth: true })

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req
  switch (method) {
    case 'GET':
      return handleGetAll(req, res)
    default:
      res.setHeader('Allow', ['GET'])
      res.status(405).json({ error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGetAll = async (req: NextApiRequest, res: NextApiResponse) => {
  const headers = await pgMetaHeaders(req)
  const response = await fetchGet(getPgMetaRedirectUrl(req, 'column-privileges'), { headers })

  if (response.error) {
    const { status, message } = pgMetaError(response.error, PG_META_URL)
    return res.status(status).json({ message })
  } else {
    return res.status(200).json(response)
  }
}
