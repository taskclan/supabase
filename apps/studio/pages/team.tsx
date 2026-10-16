/**
 * /team — where Stripe returns after subscription Checkout and the billing portal.
 *
 * The engine builds those return URLs as `${CLOUD_APP_BASE_URL}/team` (with a
 * `?plan=success|cancel` flag on Checkout). This bounces the customer straight
 * back to their organization's billing page — where they started — and surfaces
 * the outcome as a toast. Falls back to the org list when there is no
 * last-visited org yet.
 */
import { useRouter } from 'next/router'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { GenericSkeletonLoader } from 'ui-patterns/ShimmeringLoader'

import { useLastVisitedOrganization } from '@/hooks/misc/useLastVisitedOrganization'
import { withAuth } from '@/hooks/misc/withAuth'
import type { NextPageWithLayout } from '@/types'

const TeamRedirect: NextPageWithLayout = () => {
  const router = useRouter()
  const { isSuccess, lastVisitedOrganization } = useLastVisitedOrganization()
  const done = useRef(false)

  useEffect(() => {
    if (done.current || !router.isReady || !isSuccess) return
    done.current = true
    const plan = typeof router.query.plan === 'string' ? router.query.plan : undefined
    if (plan === 'success') toast.success('Your subscription is active')
    else if (plan === 'cancel') toast.message('Checkout canceled — your plan is unchanged')
    void router.replace(
      lastVisitedOrganization ? `/org/${lastVisitedOrganization}/billing` : '/organizations'
    )
  }, [router, isSuccess, lastVisitedOrganization])

  return (
    <div className="p-6">
      <GenericSkeletonLoader />
    </div>
  )
}

export default withAuth(TeamRedirect)
