/**
 * The one org id, shared by the projects and organizations handlers.
 *
 * Studio matches a project to its org by comparing `project.organization_id`
 * to `organization.id`. If the two handlers derive that number differently the
 * dashboard does not error — it renders an org with no apps in it, and apps
 * that belong to nothing. So both read it from here.
 *
 * Cached per process because it cannot change for the life of the key: an
 * `sk_cloud_*` key resolves to exactly one org. The cache is a small win on a
 * warm server and, more usefully, means the projects list does not pay a
 * second round trip on every call.
 */
import { getCloudOrg, type CloudResult } from './client'
import { numericIdFor } from './projects'

export interface TaskclanOrg {
  uuid: string
  /** numericIdFor(uuid) — what Studio's types want. */
  id: number
  name: string
}

let cached: TaskclanOrg | null = null

/** Clear the cache. Tests only; a running server has no reason to. */
export function resetOrgCache(): void {
  cached = null
}

/**
 * Resolve the org behind the configured key.
 *
 * Returns the failure rather than a placeholder. A placeholder org id would be
 * consistent with nothing, and every app would render as orphaned — which
 * looks like data loss rather than a configuration problem.
 */
export async function taskclanOrg(): Promise<CloudResult<TaskclanOrg>> {
  if (cached) return { ok: true, data: cached }

  const result = await getCloudOrg()
  if (!result.ok) return result
  if (!result.data) {
    return { ok: false, reason: 'http_error', detail: 'the API key resolves to no organisation' }
  }

  cached = {
    uuid: result.data.id,
    id: numericIdFor(result.data.id),
    name: result.data.name,
  }
  return { ok: true, data: cached }
}
