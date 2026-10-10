import { createFileRoute } from '@tanstack/react-router'

import { OrganizationSettingsLayout } from '@/components/layouts/ProjectLayout/OrganizationSettingsLayout'
import OrgDomainsPage from '@/pages/org/[slug]/domains'

export const Route = createFileRoute('/_app/org/$slug/domains')({
  component: OrgDomains,
  staticData: {
    orgLayoutTitle: 'Domains',
  },
})

function OrgDomains() {
  return (
    <OrganizationSettingsLayout>
      <OrgDomainsPage dehydratedState={undefined} />
    </OrganizationSettingsLayout>
  )
}
