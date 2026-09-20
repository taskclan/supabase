/**
 * Client-safe read of the self-serve signup flag.
 *
 * The server path reads `CLOUD_WEB_SIGNUP_ENABLED` (see lib/taskclan/session.ts,
 * which also pulls in Node-only crypto/async_hooks and so must never be imported
 * from a component). The browser needs the same switch, so it reads the
 * NEXT_PUBLIC_ mirror — inlined at build time, flipped by a redeploy like every
 * other NEXT_PUBLIC var. Set both to the same value.
 *
 * Everything downstream is gated on this being exactly 'true', so with it unset
 * the console behaves byte-for-byte as it does today (single-tenant, no auth).
 */
export function cloudSignupEnabledClient(): boolean {
  return process.env.NEXT_PUBLIC_CLOUD_WEB_SIGNUP_ENABLED === 'true'
}
