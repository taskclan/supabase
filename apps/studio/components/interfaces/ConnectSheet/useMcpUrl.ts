import { useParams } from 'common'
import { useMemo } from 'react'
import {
  FEATURE_GROUPS_NON_PLATFORM,
  FEATURE_GROUPS_PLATFORM,
  getMcpUrl,
} from 'ui-patterns/McpUrlBuilder'

import { StepContentProps } from './Connect.types'
import { useTaskclanConnectInfo } from './useTaskclanConnection'
import { IS_PLATFORM } from '@/lib/constants'

export function useMcpUrl(
  state: StepContentProps['state'],
  projectKeys: StepContentProps['projectKeys']
): string {
  const { ref: projectRef } = useParams()
  const readonly = Boolean(state.mcpReadonly)
  // Self-hosted Taskclan's MCP is the Cloud control-plane MCP on the engine, not
  // `${apiUrl}/mcp` (apiUrl points at the shared Supabase REST, which runs no
  // MCP). It is org-scoped and takes an sk_cloud key, so the project-MCP knobs
  // (read_only, feature groups, project_ref) don't apply — we pass none.
  const taskclanMcpUrl = useTaskclanConnectInfo()?.mcpUrl ?? undefined

  return useMemo(() => {
    const selectedFeatures = Array.isArray(state.mcpFeatures) ? state.mcpFeatures : []
    const supportedFeatures = IS_PLATFORM ? FEATURE_GROUPS_PLATFORM : FEATURE_GROUPS_NON_PLATFORM
    const validFeatures = selectedFeatures.filter((f) =>
      supportedFeatures.some((group) => group.id === f)
    )

    return getMcpUrl({
      projectRef,
      isPlatform: IS_PLATFORM,
      // In Taskclan mode, force the Cloud MCP URL and drop the project-MCP knobs.
      apiUrl: IS_PLATFORM ? (projectKeys.apiUrl ?? undefined) : undefined,
      nonPlatformUrl: IS_PLATFORM ? undefined : taskclanMcpUrl,
      readonly: IS_PLATFORM ? readonly : false,
      features: IS_PLATFORM ? validFeatures : [],
    }).mcpUrl
  }, [projectKeys.apiUrl, projectRef, readonly, state.mcpFeatures, taskclanMcpUrl])
}
