import { useParams } from 'common'
import { usePathname, useRouter } from 'next/navigation'
import { ComponentProps, ReactNode } from 'react'
import { cn } from 'ui'

import { EditorNavigationButton } from '../EditorNavigationButton'
import { ProjectLayoutWithAuth } from '../ProjectLayout'
import { TaskclanNoDatabase, useTaskclanDbStatus } from '@/components/interfaces/TaskclanNoDatabase'
import { CollapseButton } from '../Tabs/CollapseButton'
import { EditorTabs } from '../Tabs/Tabs'
import { useEditorType } from './EditorsLayout.hooks'
import { useIsTemporarySqlEditorVisit } from '@/hooks/misc/useIsTemporarySqlEditorVisit'
import { useTrack } from '@/lib/telemetry/track'
import { useTabsStateSnapshot } from '@/state/tabs'

export interface ExplorerLayoutProps extends ComponentProps<typeof ProjectLayoutWithAuth> {
  children: ReactNode
  title?: string
  product?: string
  productMenuClassName?: string
}

export const EditorBaseLayout = ({
  children,
  title,
  product,
  productMenuClassName,
  productMenu,
  browserTitle,
}: ExplorerLayoutProps) => {
  const dbStatus = useTaskclanDbStatus()
  const { ref } = useParams()
  const pathname = usePathname()
  const editor = useEditorType()
  const tabs = useTabsStateSnapshot()

  const hasNoOpenTabs =
    editor === 'table' ? tabs.openTabs.filter((x) => !x.startsWith('sql')).length === 0 : false
  const hideTabs =
    pathname === `/project/${ref}/editor` || pathname === `/project/${ref}/sql` || hasNoOpenTabs

  const activeEditorTab = tabs.activeTab ? tabs.tabsMap[tabs.activeTab] : undefined
  // Prefer the live tab label so browser titles update immediately after a rename,
  // even when persisted tab metadata is still catching up.
  const activeEditorTabLabel = activeEditorTab?.label ?? activeEditorTab?.metadata?.name
  const activeEditorTabEntity =
    activeEditorTab === undefined
      ? undefined
      : editor === 'sql'
        ? activeEditorTab.type === 'sql'
          ? activeEditorTabLabel
          : undefined
        : editor === 'table'
          ? activeEditorTab.type !== 'sql'
            ? activeEditorTabLabel
            : undefined
          : undefined

  const mergedBrowserTitle = {
    ...browserTitle,
    section: title ?? browserTitle?.section,
    entity: browserTitle?.entity ?? activeEditorTabEntity,
  }

  // No managed database: the schema/table sidebar and the editor tabs both drive
  // pg-meta, which has nothing to talk to and renders "Failed to load schemas /
  // tables" — the same outage-for-a-non-problem the panel replaces. Suppress the
  // whole editor chrome and show only the panel. `dbStatus` is undefined while
  // the check is in flight, so the normal editor renders until we know.
  const noDatabase = dbStatus?.configured === false

  return (
    <ProjectLayoutWithAuth
      resizableSidebar
      product={product}
      browserTitle={mergedBrowserTitle}
      productMenuBadge={editor === 'sql' ? <BackToExplorerButton /> : undefined}
      productMenuClassName={productMenuClassName}
      productMenu={noDatabase ? undefined : productMenu}
    >
      {noDatabase ? (
        <TaskclanNoDatabase />
      ) : (
        <div className="flex flex-col h-full">
          <div
            className={cn(
              'h-10 md:min-h-(--header-height) flex items-center',
              !hideTabs ? 'bg-surface-200 dark:bg-alternative' : 'bg-surface-100'
            )}
          >
            {hideTabs ? <CollapseButton hideTabs={hideTabs} /> : <EditorTabs />}
          </div>
          <div className="h-full">{children}</div>
        </div>
      )}
    </ProjectLayoutWithAuth>
  )
}

const BackToExplorerButton = () => {
  const { ref } = useParams()
  const router = useRouter()
  const track = useTrack()
  const { isTemporary, setIsTemporary } = useIsTemporarySqlEditorVisit(ref)

  if (!ref || !isTemporary) return null

  return (
    <EditorNavigationButton
      tooltip="Back to Explorer"
      onClick={() => {
        setIsTemporary(false)
        track('sql_editor_back_explorer_clicked')
        router.push(`/project/${ref}/explorer`)
      }}
    />
  )
}
