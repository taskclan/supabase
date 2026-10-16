import { SidePanelVercelProjectLinker } from './SidePanelVercelProjectLinker'
import { TaskclanGitHubSection } from './TaskclanGitHubSection'
import { GitHubSection } from '@/components/interfaces/Settings/Integrations/GithubIntegration/GithubSection'
import { VercelSection } from '@/components/interfaces/Settings/Integrations/VercelIntegration/VercelSection'
import { useIsFeatureEnabled } from '@/hooks/misc/useIsFeatureEnabled'
import { IS_PLATFORM } from '@/lib/constants'

/**
 * What this organisation can connect to.
 *
 * Both upstream sections talk to Supabase's own integrations API, which this
 * build does not serve, so on Taskclan Cloud the page offered two things that
 * could only fail. GitHub is replaced with the equivalent that does work;
 * Vercel is removed rather than replaced, because Taskclan has no Vercel
 * integration to put behind it and a card advertising one is worse than no
 * card at all.
 *
 * Both are still rendered on platform, so this file stays useful upstream and
 * rebaseable.
 */
export const IntegrationSettings = () => {
  const showVercelIntegration = useIsFeatureEnabled('integrations:vercel')

  if (!IS_PLATFORM) return <TaskclanGitHubSection />

  return (
    <>
      <GitHubSection isProjectScoped={false} />
      {showVercelIntegration && (
        <>
          <VercelSection isProjectScoped={false} />
          <SidePanelVercelProjectLinker />
        </>
      )}
    </>
  )
}
