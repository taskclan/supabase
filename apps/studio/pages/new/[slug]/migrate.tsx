import Head from 'next/head'
import { PropsWithChildren } from 'react'

import { TaskclanMigrateForm } from '@/components/interfaces/ProjectCreation/TaskclanMigrateForm'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import { WizardLayoutWithoutAuth } from '@/components/layouts/WizardLayout'
import { useCustomContent } from '@/hooks/custom-content/useCustomContent'
import { withAuth } from '@/hooks/misc/withAuth'
import { buildStudioPageTitle } from '@/lib/page-title'
import type { NextPageWithLayout } from '@/types'

/**
 * `/new/[slug]/migrate` — bring an existing app over from Heroku or Vercel.
 *
 * The sibling of `/new/[slug]` (create a project): same wizard chrome, but the
 * import path rather than the empty/GitHub one. Taskclan-Cloud only, and reached
 * from a link on the create-project form.
 */
const MigrateWizard: NextPageWithLayout = () => {
  const { appTitle } = useCustomContent(['app:title'])
  const pageTitle = buildStudioPageTitle({
    section: 'Migrate an app',
    brand: appTitle || 'Supabase',
  })

  return (
    <>
      {/* Wizard layouts set the visual header but not the browser tab title. */}
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content="Supabase Studio" />
      </Head>
      <TaskclanMigrateForm />
    </>
  )
}

const PageLayout = withAuth(({ children }: PropsWithChildren) => {
  return <WizardLayoutWithoutAuth>{children}</WizardLayoutWithoutAuth>
})

MigrateWizard.getLayout = (page) => (
  <DefaultLayout hideMobileMenu headerTitle="Migrate an app">
    <PageLayout>{page}</PageLayout>
  </DefaultLayout>
)

export default MigrateWizard
