import { TaskclanDeploySettings } from '@/components/interfaces/Settings/TaskclanDeploySettings'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import SettingsLayout from '@/components/layouts/ProjectSettingsLayout/SettingsLayout'
import type { NextPageWithLayout } from '@/types'

const DeploymentSettingsPage: NextPageWithLayout = () => {
  return <TaskclanDeploySettings />
}

DeploymentSettingsPage.getLayout = (page) => (
  <DefaultLayout>
    <SettingsLayout title="Deployments">{page}</SettingsLayout>
  </DefaultLayout>
)

export default DeploymentSettingsPage
