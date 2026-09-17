import { PageContainer } from 'ui-patterns/PageContainer'
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderMeta,
  PageHeaderSummary,
  PageHeaderTitle,
} from 'ui-patterns/PageHeader'

import { TaskclanApiKeys } from '@/components/interfaces/Organization/TaskclanApiKeys'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import OrganizationLayout from '@/components/layouts/OrganizationLayout'
import type { NextPageWithLayout } from '@/types'

/**
 * Cloud API keys for the organization.
 *
 * Org-scoped rather than project-scoped because the engine scopes them that
 * way: one key reaches every app in the org. Deliberately not the same thing as
 * the project-level "API Keys" screen, which carries a Supabase project's anon
 * and service_role keys for its database — hence the description saying which
 * API these open.
 */
const OrgApiKeys: NextPageWithLayout = () => {
  return (
    <>
      <PageHeader size="small">
        <PageHeaderMeta>
          <PageHeaderSummary>
            <PageHeaderTitle>API Keys</PageHeaderTitle>
            <PageHeaderDescription>
              Keys for the Taskclan Cloud API, used by CI, scripts and MCP clients
            </PageHeaderDescription>
          </PageHeaderSummary>
        </PageHeaderMeta>
      </PageHeader>
      <PageContainer size="small">
        <TaskclanApiKeys />
      </PageContainer>
    </>
  )
}

OrgApiKeys.getLayout = (page) => (
  <DefaultLayout>
    <OrganizationLayout title="API Keys">{page}</OrganizationLayout>
  </DefaultLayout>
)

export default OrgApiKeys
