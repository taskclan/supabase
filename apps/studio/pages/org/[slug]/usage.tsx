import { TaskclanUsage } from '@/components/interfaces/Organization/Usage/TaskclanUsage'
import { Usage } from '@/components/interfaces/Organization/Usage/Usage'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import OrganizationLayout from '@/components/layouts/OrganizationLayout'
import { IS_PLATFORM } from '@/lib/constants'
import type { NextPageWithLayout } from '@/types'

/**
 * Upstream's Usage screen describes Supabase's product: compute hours on a
 * dedicated instance, database size, monthly active users, quota progress bars.
 * Taskclan Cloud meters containers per second against a prepaid balance, so
 * that screen had nothing true to show and said so with an error and a billing
 * period of 01 Jan 1970.
 */
const OrgUsage: NextPageWithLayout = () => {
  return IS_PLATFORM ? <Usage /> : <TaskclanUsage />
}

OrgUsage.getLayout = (page) => (
  <DefaultLayout>
    <OrganizationLayout title="Usage">{page}</OrganizationLayout>
  </DefaultLayout>
)

export default OrgUsage
