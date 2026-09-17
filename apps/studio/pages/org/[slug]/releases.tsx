import { PageContainer } from 'ui-patterns/PageContainer'
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderSummary,
  PageHeaderTitle,
} from 'ui-patterns/PageHeader'

import { TaskclanReleases } from '@/components/interfaces/Organization/TaskclanReleases'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import OrganizationLayout from '@/components/layouts/OrganizationLayout'
import type { NextPageWithLayout } from '@/types'

/**
 * Releases held for a person.
 *
 * Org-scoped because a release queue is: one push to a shared repo opens an
 * intent for every app mapped to it, across the organisation. A per-project
 * version would hide the one app that is actually waiting behind a project
 * switcher.
 */
const OrgReleases: NextPageWithLayout = () => {
  return (
    <PageContainer size="large">
      <PageHeader>
        <PageHeaderSummary>
          <PageHeaderTitle>Releases</PageHeaderTitle>
          <PageHeaderDescription>
            Apps set to deploy manually open a release on every push and wait here. Approving one
            starts its build immediately.
          </PageHeaderDescription>
        </PageHeaderSummary>
      </PageHeader>
      <div className="flex flex-col gap-4">
        <TaskclanReleases />
      </div>
    </PageContainer>
  )
}

OrgReleases.getLayout = (page) => (
  <DefaultLayout>
    <OrganizationLayout title="Releases">{page}</OrganizationLayout>
  </DefaultLayout>
)

export default OrgReleases
