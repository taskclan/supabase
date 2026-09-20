import { cloudSignupEnabled } from '@/lib/taskclan/session'

/**
 * Refuse a route that reaches the SHARED project's admin credentials — its
 * SUPABASE_URL + service_role key, or its auth.
 *
 * Those credentials reach the whole shared database and every product's auth
 * users, scoped to no org. The panels that use them (auth invite/magiclink/
 * recover/OTP, the project's temporary service key, REST/GraphQL introspection,
 * the edge-function tester) all pertain to the shared project and do not map to
 * a Taskclan app. So on the multi-tenant customer path they must fail closed —
 * the throw becomes a 500 with no data, which is correct: there is nothing here
 * for a customer to see. No-op when signup is off (plain self-hosted, unchanged).
 */
export function assertSharedAdminAllowed(): void {
  if (cloudSignupEnabled()) {
    throw new Error('This panel is not available in Taskclan Cloud.')
  }
}
