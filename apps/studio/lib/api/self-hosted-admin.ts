import { createClient, SupabaseClient } from '@supabase/supabase-js'

import { cloudSignupEnabled } from '@/lib/taskclan/session'

// Lazy admin client for self-hosted API routes under
// `pages/api/platform/{auth,storage}/**`. SUPABASE_URL and
// SUPABASE_SERVICE_KEY are only set on self-hosted deployments — the
// platform build doesn't need these env vars. But on the TanStack Start
// server, every API route's module gets evaluated when the single function
// handler loads, regardless of whether its URL is hit. Without a lazy
// wrapper, constructing the client at module scope with undefined
// credentials would crash every request on platform.
//
// Proxy defers client construction until a property is actually accessed,
// which only happens inside the handler (i.e. on self-hosted where the env
// vars are set).
let _client: SupabaseClient | undefined

export const selfHostedSupabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    // Multi-tenant guard. This is the SHARED project's service_role client — its
    // auth holds every product's users (thousands), its storage is shared, and
    // it is scoped to no org. The auth/storage panels that use it do not map to
    // a Taskclan app, so on a customer path it must never run: one customer
    // would otherwise get admin over the shared auth and storage. Fail closed —
    // apiWrapper turns the throw into a 500 with no data. (Off ⇒ unchanged.)
    if (cloudSignupEnabled()) {
      throw new Error('The auth and storage admin panels are not available in Taskclan Cloud.')
    }
    _client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
    return Reflect.get(_client, prop)
  },
})
