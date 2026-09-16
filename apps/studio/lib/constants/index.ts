// Ignore barrel file rule here since it's just exporting more constants
// eslint-disable-next-line barrel-files/avoid-re-export-all
export * from './infrastructure'

export const IS_PLATFORM = process.env.NEXT_PUBLIC_IS_PLATFORM === 'true'

/**
 * Server-side flag for Supabase CLI (local development) runs. Detected via
 * CURRENT_CLI_VERSION, which the CLI sets when launching Studio. The browser
 * cannot read this directly — use the /platform/deployment-mode endpoint.
 */
export const IS_CLI = !IS_PLATFORM && !!process.env.CURRENT_CLI_VERSION

/**
 * Indicates that the app is running in a test environment (E2E tests).
 * Set via NEXT_PUBLIC_NODE_ENV=test in the generateLocalEnv.js script.
 */
export const IS_TEST_ENV = process.env.NEXT_PUBLIC_NODE_ENV === 'test'

/**
 * True when running against the staging or local environments. Used to gate
 * staff-only debugging affordances (e.g. the unified logs OTEL toggle) that
 * should never be visible to customers on production.
 */
export const IS_STAGING_OR_LOCAL =
  process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging' ||
  process.env.NEXT_PUBLIC_ENVIRONMENT === 'local'

/**
 * Base URL for the internal Admin Studio tool (kept out of source since this
 * repo is public).
 */
export const ADMIN_STUDIO_URL = process.env.NEXT_PUBLIC_ADMIN_STUDIO_URL

export const API_URL = (() => {
  if (process.env.NODE_ENV === 'test') return 'http://localhost:3000/api'
  //  If running in platform, use API_URL from the env var
  if (IS_PLATFORM) return process.env.NEXT_PUBLIC_API_URL!
  // If running in browser, let it add the host
  if (typeof window !== 'undefined') return '/api'
  // If running self-hosted Vercel preview, use VERCEL_URL
  if (!!process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api`
  // If running on self-hosted, use NEXT_PUBLIC_SITE_URL
  if (!!process.env.NEXT_PUBLIC_SITE_URL) return `${process.env.NEXT_PUBLIC_SITE_URL}/api`
  return '/api'
})()

export const PG_META_URL = IS_PLATFORM
  ? process.env.PLATFORM_PG_META_URL
  : process.env.STUDIO_PG_META_URL
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * @deprecated use DATETIME_FORMAT
 */
export const DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ssZ'

// should be used for all dayjs formattings shown to the user. Includes timezone info.
export const DATETIME_FORMAT = 'DD MMM YYYY, HH:mm:ss (ZZ)'

export const GOTRUE_ERRORS = {
  UNVERIFIED_GITHUB_USER: 'Error sending confirmation mail',
}

export const STRIPE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY || 'pk_test_XVwg5IZH3I9Gti98hZw6KRzd00v5858heG'

export const USAGE_APPROACHING_THRESHOLD = 0.75

export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || 'https://supabase.com/docs'
// Taskclan's own docs. Kept separate from DOCS_URL because most DOCS_URL links
// use Supabase's page paths, which don't exist on the Taskclan docs site.
export const TASKCLAN_DOCS_URL =
  process.env.NEXT_PUBLIC_TASKCLAN_DOCS_URL || 'https://docs.taskclan.com'

/**
 * Taskclan's own community + status links, used by the Help panel in place of
 * Supabase's (discord.supabase.com / status.supabase.com). Env-overridable so
 * they can change without a code edit. Status is empty by default — there is no
 * Taskclan status page yet, and the Help panel hides the pill when it is unset
 * rather than pointing at Supabase's.
 */
export const TASKCLAN_DISCORD_URL =
  process.env.NEXT_PUBLIC_TASKCLAN_DISCORD_URL || 'https://discord.gg/vWwRC8pCa'
export const TASKCLAN_STATUS_URL = process.env.NEXT_PUBLIC_TASKCLAN_STATUS_URL || ''

/**
 * What this console calls itself outside its own UI.
 *
 * The application-name and description meta tags said "Supabase Studio" —
 * never visible on a page, and so the last branding anyone thought to check.
 * It is what a browser uses when the console is installed or pinned, and what
 * a shared link unfurls as, which makes it the first thing someone outside the
 * product sees.
 */
export const TASKCLAN_PRODUCT_NAME = 'Taskclan Cloud'

/**
 * Whether this console signs people in.
 *
 * Derived from the presence of its own configuration rather than being a
 * separate switch, which is the whole migration-safety story: the feature can
 * land dark, turning it on is a CI variable change instead of a code change,
 * and the failure mode of a half-done rollout is "auth stays off" rather than
 * "sign-in page pointed at localhost".
 *
 * Build-time, because `NEXT_PUBLIC_*` is inlined by Next. Turning auth ON needs
 * a rebuild; turning the OLD path off is `TASKCLAN_SHARED_KEY_FALLBACK`, which
 * is deliberately a runtime variable so a rollback does not wait on one.
 */
export const TASKCLAN_AUTH_ENABLED =
  !!process.env.NEXT_PUBLIC_TASKCLAN_AUTH_URL && !!process.env.NEXT_PUBLIC_TASKCLAN_AUTH_ANON_KEY
export const SPECIAL_SYMBOLS_IN_PASSWORDS_DOCS_URL = `${DOCS_URL}/guides/database/postgres/roles#special-symbols-in-passwords`

export const OPT_IN_TAGS = {
  AI_SQL: 'AI_SQL_GENERATOR_OPT_IN',
  AI_DATA: 'AI_DATA_GENERATOR_OPT_IN',
  AI_LOG: 'AI_LOG_GENERATOR_OPT_IN',
}

export const GB = 1024 * 1024 * 1024
export const MB = 1024 * 1024
export const KB = 1024

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
