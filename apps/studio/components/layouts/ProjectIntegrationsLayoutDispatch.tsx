import type { PropsWithChildren } from 'react'

import { ProjectIntegrationsLayout } from './ProjectIntegrationsLayout'
import { ProjectMarketplaceLayout } from './ProjectMarketplaceLayout'
import { useIsMarketplaceEnabled } from '@/components/interfaces/App/FeaturePreview/FeaturePreviewContext'
import { TaskclanNoDatabase, useTaskclanDbStatus } from '@/components/interfaces/TaskclanNoDatabase'
import { ProjectLayout } from '@/components/layouts/ProjectLayout'

export const ProjectIntegrationsLayoutDispatch = ({ children }: PropsWithChildren) => {
  const dbStatus = useTaskclanDbStatus()
  const isMarketplaceEnabled = useIsMarketplaceEnabled()

  // Integrations are database features — extensions, wrappers (FDWs), Postgres
  // modules. An app with no managed database has nothing to integrate, and the
  // layouts below run schema/extension/FDW queries that would otherwise surface a
  // raw "API error happened while trying to communicate with the server". Show
  // the honest no-database panel instead, with no integrations sidebar to fail.
  //
  // `dbStatus` is undefined while the check is in flight, so a real database
  // renders its normal layout and never flashes this panel.
  if (dbStatus?.configured === false) {
    return (
      <ProjectLayout product="Integrations" isBlocking={false}>
        <TaskclanNoDatabase />
      </ProjectLayout>
    )
  }

  if (isMarketplaceEnabled) {
    return <ProjectMarketplaceLayout>{children}</ProjectMarketplaceLayout>
  }
  return <ProjectIntegrationsLayout>{children}</ProjectIntegrationsLayout>
}
