import Link from 'next/link'
import { Badge, cn, Tooltip, TooltipContent, TooltipTrigger } from 'ui'
import { ShimmeringLoader } from 'ui-patterns/ShimmeringLoader'

import { InstanceConfiguration } from '../Settings/Infrastructure/InfrastructureConfiguration/InstanceConfiguration'
import { ActivityStats } from '@/components/interfaces/ProjectHome/ActivityStats'
import { TaskclanOverview } from '@/components/interfaces/ProjectHome/TaskclanOverview'
import { TaskclanHeaderUrl } from '@/components/interfaces/ProjectHome/TaskclanHeaderUrl'
import { ProjectConnectionPopover } from '@/components/interfaces/ProjectHome/ProjectConnectionPopover'
import { ProjectPausedState } from '@/components/layouts/ProjectLayout/PausedState/ProjectPausedState'
import { InlineLink } from '@/components/ui/InlineLink'
import { ProjectUpgradeFailedBanner } from '@/components/ui/ProjectUpgradeFailedBanner'
import { useBranchesQuery } from '@/data/branches/branches-query'
import { useProjectDetailQuery } from '@/data/projects/project-detail-query'
import { useIsOrioleDb, useSelectedProjectQuery } from '@/hooks/misc/useSelectedProject'
import { DOCS_URL, IS_PLATFORM, PROJECT_STATUS } from '@/lib/constants'

export const TopSection = () => {
  const isOrioleDb = useIsOrioleDb()
  const { data: project, isLoading } = useSelectedProjectQuery()
  const { data: parentProject } = useProjectDetailQuery({ ref: project?.parent_project_ref })

  const { data: branches } = useBranchesQuery({
    projectRef: project?.parent_project_ref ?? project?.ref,
  })

  const mainBranch = branches?.find((branch) => branch.is_default)
  const currentBranch = branches?.find((branch) => branch.project_ref === project?.ref)
  const isMainBranch = currentBranch?.name === mainBranch?.name

  const isPaused = project?.status === PROJECT_STATUS.INACTIVE
  const projectName =
    currentBranch && !isMainBranch
      ? currentBranch.name
      : project?.name
        ? project.name
        : 'Welcome to your project'

  if (isPaused) {
    return <ProjectPausedState />
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div
        className={cn(
          'grid grid-cols-1 gap-8 py-0 w-full items-center',
          IS_PLATFORM && 'md:grid-cols-2'
        )}
      >
        <div className="flex flex-col">
          <div className="flex flex-row flex-wrap items-center gap-4 w-full">
            <div>
              {!isMainBranch && (
                <Link
                  href={`/project/${parentProject?.ref}`}
                  className="text-sm text-foreground-light"
                >
                  {parentProject?.name}
                </Link>
              )}
              <div className="flex items-center gap-x-2">
                {isLoading ? (
                  <ShimmeringLoader className="w-32 py-0 h-[33.6px]" />
                ) : (
                  <h1 className="text-3xl">{projectName}</h1>
                )}
                {isOrioleDb && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="warning">OrioleDB</Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-80 text-center">
                      This project is using Postgres with OrioleDB which is currently in preview and
                      not suitable for production workloads. View our{' '}
                      <InlineLink href={`${DOCS_URL}/guides/database/orioledb`}>
                        documentation
                      </InlineLink>{' '}
                      for all limitations.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {IS_PLATFORM ? (
                <ProjectConnectionPopover projectRef={project?.ref} />
              ) : (
                // A Taskclan Cloud app's header URL is where it's deployed, not
                // the stubbed Supabase API URL (localhost:8000).
                <TaskclanHeaderUrl projectRef={project?.ref} />
              )}
            </div>
          </div>
          {IS_PLATFORM ? (
            <div className="mt-8">
              <ActivityStats />
            </div>
          ) : (
            // Self-hosted: ActivityStats and the infra panel below are wired to
            // Supabase's platform APIs and render nothing here. This is the
            // Taskclan Cloud equivalent — real per-app status, compute, repo and
            // last deploy — so the home page is an overview rather than a title.
            <TaskclanOverview />
          )}
        </div>
        {IS_PLATFORM && (
          <div>
            <div
              className={cn(
                'w-full h-[400px] md:h-[500px] border border-muted rounded-md overflow-hidden flex flex-col relative'
              )}
            >
              <InstanceConfiguration />
            </div>
          </div>
        )}
      </div>
      <ProjectUpgradeFailedBanner />
    </div>
  )
}
