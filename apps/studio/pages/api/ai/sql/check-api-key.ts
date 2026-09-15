import { NextApiRequest, NextApiResponse } from 'next'

import { apiWrapper } from '@/lib/api/apiWrapper'
import { taskclanConfigured } from '@/lib/ai/taskclan-provider'

const wrapper = (req: NextApiRequest, res: NextApiResponse) =>
  apiWrapper(req, res, handler, { withAuth: true })

export default wrapper

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

const handleGet = async (_req: NextApiRequest, res: NextApiResponse) => {
  // The assistant is available when EITHER provider is configured. Taskclan
  // Intelligence is the primary one here (assistantProvider prefers it); the
  // banner should not say "OpenAI API key not set" when the assistant is in
  // fact wired to Taskclan.
  const hasKey = taskclanConfigured() || !!process.env.OPENAI_API_KEY
  return res.status(200).json({ hasKey })
}
