import { useParams } from 'common'
import { useEffect } from 'react'

import { BillingSettings } from '@/components/interfaces/Organization/BillingSettings/BillingSettings'
import { TaskclanBilling } from '@/components/interfaces/Organization/BillingSettings/TaskclanBilling'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import OrganizationLayout from '@/components/layouts/OrganizationLayout'
import { UnknownInterface } from '@/components/ui/UnknownInterface'
import { useIsFeatureEnabled } from '@/hooks/misc/useIsFeatureEnabled'
import { IS_PLATFORM } from '@/lib/constants'
import {
  ORG_SETTINGS_PANEL_KEYS,
  useOrgSettingsPageStateSnapshot,
} from '@/state/organization-settings'
import type { NextPageWithLayout } from '@/types'

const OrgBillingSettings: NextPageWithLayout = () => {
  const { panel, slug } = useParams()
  const snap = useOrgSettingsPageStateSnapshot()

  const showBilling = useIsFeatureEnabled('billing:all')

  useEffect(() => {
    const allowedValues = ['subscriptionPlan', 'costControl']
    if (panel && typeof panel === 'string' && allowedValues.includes(panel)) {
      snap.setPanelKey(panel as ORG_SETTINGS_PANEL_KEYS)
      document.getElementById('billing-page-top')?.scrollIntoView({ behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel])

  if (!showBilling) {
    return <UnknownInterface urlBack={`/org/${slug}`} />
  }

  // Upstream's page describes a subscription: an included quota, a spend cap
  // for scaling past it, an invoice accruing through a billing cycle. Cloud
  // sells prepaid credits and meters against the balance, so that page had
  // nothing to retrieve and said so four times over.
  return IS_PLATFORM ? <BillingSettings /> : <TaskclanBilling />
}

OrgBillingSettings.getLayout = (page) => (
  <DefaultLayout>
    <OrganizationLayout title="Billing">{page}</OrganizationLayout>
  </DefaultLayout>
)
export default OrgBillingSettings
