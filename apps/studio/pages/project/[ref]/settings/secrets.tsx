import { TaskclanSecrets } from '@/components/interfaces/TaskclanSecrets'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import SettingsLayout from '@/components/layouts/ProjectSettingsLayout/SettingsLayout'
import type { NextPageWithLayout } from '@/types'

const SecretsPage: NextPageWithLayout = () => {
  return <TaskclanSecrets />
}

SecretsPage.getLayout = (page) => (
  <DefaultLayout>
    <SettingsLayout title="Secrets">{page}</SettingsLayout>
  </DefaultLayout>
)

export default SecretsPage
