import { TASKCLAN_AUTH_ENABLED } from '@/lib/constants'

/**
 * Refuse a route that reaches the SHARED project's admin credentials — its
 * SUPABASE_URL + service_role key, or its auth.
 *
 * Those credentials reach the whole shared database and every product's auth
 * users, scoped to no org. The panels that use them (auth invite/magiclink/
 * recover/OTP, the project's temporary service key, REST/GraphQL introspection,
 * the edge-function tester) all pertain to the shared project and do not map to
 * a Taskclan app. So once per-user auth is on (TASKCLAN_AUTH_ENABLED), they must
 * fail closed: one signed-in customer would otherwise get admin over the shared
 * auth and storage. Unlike the engine calls — which `callerContext`/`engineProxy`
 * scope by forwarding the user's JWT — these hit the shared Supabase directly,
 * so nothing else stops them. The throw becomes a 500 with no data, which is
 * correct: there is nothing here for a customer to see. No-op when auth is off
 * (plain self-hosted / internal single-tenant, unchanged).
 */
export function assertSharedAdminAllowed(): void {
  if (TASKCLAN_AUTH_ENABLED) {
    throw new Error('This panel is not available in Taskclan Cloud.')
  }
}
