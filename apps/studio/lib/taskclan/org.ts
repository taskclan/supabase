/**
 * The caller's organisations, shared by the projects and organizations handlers.
 *
 * Studio matches a project to its org by comparing `project.organization_id`
 * to `organization.id`. If the two handlers derive that number differently the
 * dashboard does not error, it renders an org with no apps in it and apps that
 * belong to nothing. So both read it from here.
 *
 * This module used to cache one org for the life of the process, on the
 * reasoning that an `sk_cloud_*` key resolves to exactly one org and cannot
 * change. That was true of the key and false of a person: with per-user auth
 * the next request comes from somebody else, and a process-wide cache would
 * serve them the previous visitor's organisation. The cache is gone rather than
 * scoped, because the round trip it saved is not worth the shape of the bug it
 * invites. If it returns, it must be keyed by caller.
 */
import { listCloudOrgs, type CloudOrg, type CloudResult } from './client'
import type { Caller } from './callerContext'
import { numericIdFor } from './projects'

export interface TaskclanOrg {
  uuid: string
  /** numericIdFor(uuid) — what Studio's types want. */
  id: number
  name: string
  /** The engine's own slug. Studio routes org URLs on it. */
  slug: string
}

/**
 * Give each org a numeric id, resolving any collision.
 *
 * `numericIdFor` folds a UUID into 32 bits, which was unambiguous when there
 * was exactly one org and is not once there are many. Studio decides which apps
 * belong to which org by comparing these numbers, so a collision does not throw:
 * it renders one tenant's apps under another tenant's organisation. That is the
 * worst failure shape available, so it is worth the few lines to rule out.
 *
 * Collisions are resolved by salting and rehashing rather than by picking the
 * next free integer, so an id stays a pure function of the uuid and the orgs
 * that collided with it, and does not shift as unrelated orgs are added.
 */
export function assignNumericIds(orgs: CloudOrg[]): Map<string, number> {
  const byUuid = new Map<string, number>()
  const taken = new Set<number>()

  for (const org of orgs) {
    let id = numericIdFor(org.id)
    let salt = 0
    while (taken.has(id)) {
      salt += 1
      id = numericIdFor(`${org.id}#${salt}`)
    }
    taken.add(id)
    byUuid.set(org.id, id)
  }

  return byUuid
}

/**
 * Does `slug` name this org?
 *
 * Accepts the legacy name-derived slug as well as the engine's own. The
 * console derived slugs from names until the engine's real ones were carried
 * through, so URLs and the stored "last visited organisation" still hold the
 * old value. Matching only the new one turns those into 404s the first time
 * somebody opens the console after the change, which looks exactly like having
 * been removed from their organisation.
 *
 * Only ever widens which slug resolves to an org the caller already belongs to,
 * so it cannot be used to reach somebody else's.
 */
export function matchesSlug(org: TaskclanOrg, slug: string): boolean {
  return org.slug === slug || derivedSlug(org.name) === slug
}

/** The slug this console used to compute from a name, kept for old URLs. */
function derivedSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Slug fallback for an engine old enough not to send one. */
function slugFor(org: CloudOrg): string {
  if (org.slug) return org.slug
  // Derived only as a last resort. Two orgs named the same would collide here,
  // which is exactly why the engine's own slug is preferred: it is generated
  // with a uniqueness loop and this is not.
  return derivedSlug(org.name) || org.id
}

/**
 * Every org the caller belongs to.
 *
 * Returns the failure rather than a placeholder. A placeholder org id would be
 * consistent with nothing, and every app would render as orphaned, which looks
 * like data loss rather than a configuration problem.
 */
export async function taskclanOrgs(
  caller: Caller
): Promise<CloudResult<{ orgs: TaskclanOrg[]; active: TaskclanOrg | null }>> {
  const result = await listCloudOrgs(caller)
  if (!result.ok) return result

  const { orgs, activeOrgId } = result.data
  const ids = assignNumericIds(orgs)
  const mapped = orgs.map((org) => ({
    uuid: org.id,
    id: ids.get(org.id) as number,
    name: org.name,
    slug: slugFor(org),
  }))

  const active = mapped.find((o) => o.uuid === activeOrgId) ?? mapped[0] ?? null
  return { ok: true, data: { orgs: mapped, active } }
}

/** The caller's active org, which is what most handlers want. */
export async function taskclanOrg(caller: Caller): Promise<CloudResult<TaskclanOrg>> {
  const result = await taskclanOrgs(caller)
  if (!result.ok) return result
  if (!result.data.active) {
    return { ok: false, reason: 'http_error', detail: 'the caller belongs to no organisation' }
  }
  return { ok: true, data: result.data.active }
}
