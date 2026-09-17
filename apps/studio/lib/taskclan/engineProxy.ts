/**
 * Which requests on the console's hostname still belong to the engine.
 *
 * `cloud.taskclan.com` is not only a web console, which is the assumption that
 * makes the domain swap look simpler than it is. Three different things answer
 * on that hostname today:
 *
 *   /                    the console UI
 *   /api/cloud/*         the Cloud API — the CLI, CI and MCP clients
 *   /git/<app>.git/*     git-over-HTTP — this is `git push taskclan main`
 *
 * Binding the hostname to the console's Worker without forwarding the last two
 * would break every CLI deploy and every script holding an sk_cloud_ key, with
 * no error anyone could act on: git would simply stop finding a remote.
 *
 * So the Worker keeps serving those two paths from the engine. Both are pure
 * protocol surfaces — git's pack negotiation and a JSON API — with no HTML and
 * no static assets, which is what makes forwarding them safe. Engine *pages*
 * are deliberately not forwarded: they would load `/_next/...` bundles that the
 * console would answer with its own, and render broken. See the note on
 * `/cloud/device` at the bottom.
 *
 * Kept here rather than inline in `deploy/worker.ts` so it is covered by the
 * studio test suite that CI already runs. The module is deliberately
 * dependency-free so the Worker can import it directly.
 */

/**
 * The engine path that serves git-over-HTTP.
 *
 * On `cloud.taskclan.com` the engine's middleware rewrites `/git/*` to
 * `/cloud/git/*` because the hostname is in its CLOUD_HOSTS set. Once the
 * Worker owns that hostname the rewrite never runs, so the Worker addresses the
 * handler at its real path instead of relying on a host it no longer controls.
 * Verified against production: `/cloud/git/<app>.git/info/refs?service=…`
 * answers `401 WWW-Authenticate: Basic` on the engine's own hostname.
 */
const GIT_PREFIX = '/git'
const GIT_TARGET_PREFIX = '/cloud/git'

/** The Cloud API needs no rewrite; it answers on any hostname. */
const CLOUD_API_PREFIX = '/api/cloud'

/** True for `/p` and `/p/...`, false for `/pfoo`. */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * The absolute engine URL this request should be forwarded to, or null when the
 * console should handle it.
 *
 * `requestUrl` is the full incoming URL; `engineOrigin` is the engine's own
 * origin (no trailing slash), which stays a real, separate hostname after the
 * swap and is therefore always reachable from the Worker.
 */
export function engineTargetFor(requestUrl: string, engineOrigin: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }

  const origin = engineOrigin.replace(/\/+$/, '')
  const { pathname, search } = url

  if (isUnder(pathname, GIT_PREFIX)) {
    // `/git/x.git/info/refs` → `/cloud/git/x.git/info/refs`
    return `${origin}${GIT_TARGET_PREFIX}${pathname.slice(GIT_PREFIX.length)}${search}`
  }

  if (isUnder(pathname, CLOUD_API_PREFIX)) {
    // Note this is `/api/cloud/*` only, never `/api/*`. The console serves its
    // own `/api/platform/*` and `/api/taskclan/*`, and forwarding those would
    // hand the engine requests it has no routes for.
    return `${origin}${pathname}${search}`
  }

  return null
}

/*
 * One engine path on this hostname is deliberately NOT forwarded, and it is the
 * remaining gap in the swap.
 *
 * `/cloud/device` is the browser page `taskclan login` opens to approve a
 * machine. It is a Next page, so forwarding its HTML would leave it requesting
 * `/_next/static/<engine build id>/…` from a Worker that only has the console's
 * own bundles: it would render without styles or JavaScript, and an approval
 * button that cannot be clicked is worse than a clean 404.
 *
 * Its URL comes from the engine's `CLOUD_APP_BASE_URL`, which also drives Stripe
 * return URLs, suspension notices and deploy origins, so it cannot be repointed
 * at the engine's hostname without moving all of those with it. The fix is
 * engine-side and small: give the device flow its own base URL, the way
 * `deploy-token` already has `CLOUD_GIT_BASE_URL`. Until that lands, approving a
 * new machine is the one CLI path this swap would still break — existing logins
 * keep working, because their credential is already in ~/.netrc.
 */
