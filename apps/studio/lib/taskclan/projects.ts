/**
 * Taskclan Cloud apps, in the shape Studio's platform API returns.
 *
 * Studio's self-hosted handlers answer `/platform/projects` from a single
 * hardcoded DEFAULT_PROJECT. This is the mapping that lets them answer from
 * Cloud's real apps instead, so the project picker lists `taskclan-engine`
 * and `forge3d` rather than "Default Project".
 *
 * Pure on purpose. The fetch lives in ./client.ts; everything interesting
 * here — how a Cloud status becomes a Studio status, how a UUID becomes the
 * numeric id Studio's types insist on — is decided without I/O so it can be
 * argued with in a test.
 */

/** The subset of `GET /api/cloud/v1/sites` this mapping reads. */
export interface CloudSite {
  id: string;
  name: string;
  subdomain?: string | null;
  host?: string | null;
  customDomain?: string | null;
  status?: string | null;
  type?: string | null;
  region?: string | null;
  orgId?: string | null;
  createdAt?: string | null;
  liveUrl?: string | null;
  deployStatus?: string | null;
  /** 'auto' ships on every merge to the default branch; 'manual' waits. */
  deployMode?: string | null;
}

/** Studio's project shape — see apps/studio/lib/constants/api.ts DEFAULT_PROJECT. */
export interface StudioProject {
  id: number;
  ref: string;
  name: string;
  organization_id: number;
  cloud_provider: string;
  status: string;
  region: string;
  inserted_at: string;
}

/**
 * Studio types a project id as a number and Cloud keys apps by UUID, so the
 * id has to be derived rather than carried.
 *
 * A hash, not an array index: the index would renumber every app whenever one
 * is created or deleted, and Studio persists the id in the URL and in the
 * "last visited project" it stores locally — so a stale link would silently
 * open a different app. FNV-1a, folded into the positive 32-bit range, gives
 * the same number for the same UUID for the life of the app.
 *
 * `ref` is the real identity and is what every screen actually routes on; the
 * number only satisfies the type.
 */
export function numericIdFor(uuid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uuid.length; i += 1) {
    h ^= uuid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 makes it unsigned; || 1 because 0 reads as "unset" in too many places.
  return (h >>> 0) || 1;
}

/**
 * Cloud's deploy status, in Studio's vocabulary.
 *
 * Studio drives real UI off these: anything other than ACTIVE_HEALTHY shows a
 * banner and disables the SQL editor, which is right — running a query against
 * an app that is mid-build should not look normal. Unknown maps to UNKNOWN
 * rather than to healthy, because guessing healthy is how a broken app looks
 * fine in the dashboard.
 */
export function studioStatusFor(site: CloudSite): string {
  const s = (site.deployStatus || site.status || '').toLowerCase();
  // Only a genuinely stopped app gates the console. A deploy that is building —
  // or one that ERRORED — must NOT be mapped to a state that shows Studio's
  // "project is unhealthy — restart" wall (ACTIVE_UNHEALTHY) or its "coming up"
  // screen (COMING_UP): that wall is a hosted-database concept, its "Restart
  // project" does nothing for a container app, and it HIDES the Deployments
  // screen — the one place that explains a failed build and can redeploy. So a
  // live app (including one whose last build failed) stays navigable, and its
  // real deploy state is shown on the overview + deployments screens, the way
  // Vercel and Heroku surface a failed deploy without locking you out of the
  // project.
  if (s === 'paused' || s === 'sleeping' || s === 'suspended') return 'INACTIVE';
  if (s === 'removed' || s === 'deleted') return 'GOING_DOWN';
  return 'ACTIVE_HEALTHY';
}

export function toStudioProject(site: CloudSite, organizationId: number): StudioProject {
  return {
    id: numericIdFor(site.id),
    // The subdomain is the human-facing handle everywhere else in Cloud (it is
    // what the URL says), so it is the better ref. Falls back to the id so a
    // site without one is still addressable rather than colliding on ''.
    ref: site.subdomain || site.id,
    name: site.name,
    organization_id: organizationId,
    // Honest about where it runs. Studio uses this only for display here.
    cloud_provider: 'cloudflare',
    status: studioStatusFor(site),
    region: site.region || 'auto',
    inserted_at: site.createdAt || new Date(0).toISOString(),
  };
}

export function toStudioProjects(sites: CloudSite[], organizationId: number): StudioProject[] {
  return sites.map((s) => toStudioProject(s, organizationId));
}

/**
 * The ref Studio uses when it means "the one project", inherited from
 * self-hosted where there is exactly one. Taskclan Cloud apps all have real
 * refs, so nothing ever matched it and every /project/default/* URL was a dead
 * end: "no Taskclan app matches default".
 */
export const DEFAULT_REF = 'default';

/**
 * Which app `default` should mean.
 *
 * Read from TASKCLAN_DEFAULT_APP rather than hardcoded, because this console
 * serves more than one organisation. A fixed app name would resolve to one
 * org's app for every visitor: wrong for everybody else, and for anyone who
 * cannot see it, the same dead end with a more confusing message.
 */
export function defaultAppPreference(): string {
  return (process.env.TASKCLAN_DEFAULT_APP ?? '').trim();
}

/**
 * Resolve `default` against the caller's OWN apps.
 *
 * The preference only applies when the caller can actually see that app, so it
 * is a preference rather than a grant: it cannot widen what anyone reaches.
 * Everyone else falls back to their own first app, which is the useful answer
 * for a URL that means "just show me something".
 */
function defaultSite(sites: CloudSite[], preference: string): CloudSite | null {
  if (preference) {
    const preferred = sites.find(
      (s) => s.subdomain === preference || s.name === preference || s.id === preference
    );
    if (preferred) return preferred;
  }
  return sites[0] ?? null;
}

/**
 * Find one app by the ref Studio routes on, matching either identity.
 *
 * `preference` defaults to the environment rather than being threaded from each
 * call site on purpose. Three places resolve refs, and if they disagreed about
 * what `default` means an app would load its page from one site and its
 * database credentials from another.
 */
export function findSiteByRef(
  sites: CloudSite[],
  ref: string,
  preference: string = defaultAppPreference()
): CloudSite | null {
  if (ref === DEFAULT_REF) return defaultSite(sites, preference);
  return sites.find((s) => s.subdomain === ref) ?? sites.find((s) => s.id === ref) ?? null;
}
