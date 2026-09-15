import { useRouter } from 'next/router'
import type { PropsWithChildren } from 'react'

import { ProjectLayout } from '../ProjectLayout'
import { TaskclanNoDatabase, useTaskclanDbStatus } from '@/components/interfaces/TaskclanNoDatabase'
import { useGenerateDatabaseMenu } from './DatabaseMenu.utils'
import { ProductMenu } from '@/components/ui/ProductMenu'
import { ProductMenuShortcuts } from '@/components/ui/ProductMenu/ProductMenuShortcuts'
import { withAuth } from '@/hooks/misc/withAuth'

export interface DatabaseLayoutProps {
  title: string
}

export const DatabaseProductMenu = () => {
  const router = useRouter()
  const page = router.pathname.split('/')[4]
  const menu = useGenerateDatabaseMenu()

  return <ProductMenu page={page} menu={menu} />
}

const DatabaseLayout = ({ children, title }: PropsWithChildren<DatabaseLayoutProps>) => {
  const dbStatus = useTaskclanDbStatus()
  const router = useRouter()
  const page = router.pathname.split('/')[4]
  const menu = useGenerateDatabaseMenu()

  // No managed database: suppress the Database nav too (every entry leads back to
  // this same panel, and the schema selector has nothing to read), so the state
  // is a clean panel rather than a sidebar of dead ends.
  const noDatabase = dbStatus?.configured === false

  return (
    <ProjectLayout
      product="Database"
      browserTitle={{ section: title }}
      productMenu={noDatabase ? undefined : <ProductMenu page={page} menu={menu} />}
      isBlocking={false}
    >
      {noDatabase ? (
        <TaskclanNoDatabase />
      ) : (
        <>
          <ProductMenuShortcuts menu={menu} />
          {children}
        </>
      )}
    </ProjectLayout>
  )
}

export default withAuth(DatabaseLayout)
