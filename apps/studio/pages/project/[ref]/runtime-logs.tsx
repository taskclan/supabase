/**
 * Runtime logs for a Taskclan Cloud app.
 *
 * Distinct from the build log on the Deployments page: that one shows the build
 * shipping; this one shows the container running (or failing to). It lives at
 * /runtime-logs rather than /logs because Studio already ships a Logflare-backed
 * /logs explorer that Taskclan Cloud does not run — the nav still labels this
 * "Logs", because that is what a person debugging a crash goes looking for.
 *
 * The key stays on the server: everything goes through /api/taskclan/{ref}/… .
 */
import { useParams } from 'common'

import { TaskclanRuntimeLogs } from '@/components/interfaces/Logs/TaskclanRuntimeLogs'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import { PageLayout } from '@/components/layouts/PageLayout/PageLayout'
import { ProjectLayoutWithAuth } from '@/components/layouts/ProjectLayout'
import { ScaffoldContainer, ScaffoldSection } from '@/components/layouts/Scaffold'
import type { NextPageWithLayout } from '@/types'

const RuntimeLogsPage: NextPageWithLayout = () => {
  const { ref } = useParams()

  return (
    <PageLayout
      title="Logs"
      subtitle="What this app printed while it was running — the first place to look when it crashes."
    >
      <ScaffoldContainer>
        <ScaffoldSection isFullWidth>
          {ref ? (
            <TaskclanRuntimeLogs projectRef={ref} />
          ) : (
            <p className="text-sm text-foreground-lighter">Loading…</p>
          )}
        </ScaffoldSection>
      </ScaffoldContainer>
    </PageLayout>
  )
}

RuntimeLogsPage.getLayout = (page) => (
  <DefaultLayout>
    <ProjectLayoutWithAuth>{page}</ProjectLayoutWithAuth>
  </DefaultLayout>
)

export default RuntimeLogsPage
