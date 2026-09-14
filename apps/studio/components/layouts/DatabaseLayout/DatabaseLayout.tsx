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

  return (
    <ProjectLayout
      product="Database"
      browserTitle={{ section: title }}
      productMenu={<ProductMenu page={page} menu={menu} />}
      isBlocking={false}
    >
      <ProductMenuShortcuts menu={menu} />
      {dbStatus && dbStatus.configured === false ? <TaskclanNoDatabase /> : children}
    </ProjectLayout>
  )
}

export default withAuth(DatabaseLayout)
