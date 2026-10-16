/**
 * Where the console sends people to sign in.
 *
 * Two details here fail in ways that are hard to read from the symptom. A
 * missing `apikey` header makes hosted Supabase answer 401 to every call on
 * /auth/v1, so sign-in looks broken rather than misconfigured. And the client is
 * built once at module load from `NEXT_PUBLIC_*` values that Next inlines at
 * build time, so getting the condition wrong is not something a restart fixes.
 *
 * Imported dynamically after setting the environment, because the client is a
 * module-level singleton; a plain top-level import would capture whatever the
 * environment happened to be first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEYS = [
  'NEXT_PUBLIC_TASKCLAN_AUTH_URL',
  'NEXT_PUBLIC_TASKCLAN_AUTH_ANON_KEY',
  'NEXT_PUBLIC_GOTRUE_URL',
] as const
let saved: Record<string, string | undefined> = {}

/** The auth client keeps these as instance fields; nothing else exposes them. */
type ClientInternals = { url: string; headers: Record<string, string> }

async function buildClient(): Promise<ClientInternals> {
  vi.resetModules()
  const { gotrueClient } = await import('common/gotrue')
  return gotrueClient as unknown as ClientInternals
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  process.env.NEXT_PUBLIC_GOTRUE_URL = 'https://upstream.example.com/auth/v1'
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.resetModules()
})

describe('the auth client', () => {
  it('points at Taskclan and sends the apikey when configured', async () => {
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_URL = 'https://proj.supabase.co'
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_ANON_KEY = 'anon-key-123'

    const client = await buildClient()

    expect(client.url).toBe('https://proj.supabase.co/auth/v1')
    // Without this every /auth/v1 call is a 401, and the console looks broken
    // rather than misconfigured.
    expect(client.headers.apikey).toBe('anon-key-123')
  })

  it('tolerates a trailing slash on the configured URL', async () => {
    // A pasted project URL usually has one, and the result would otherwise be a
    // double slash before /auth/v1.
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_URL = 'https://proj.supabase.co/'
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_ANON_KEY = 'anon-key-123'

    expect((await buildClient()).url).toBe('https://proj.supabase.co/auth/v1')
  })

  it('leaves every other app in the monorepo alone when unset', async () => {
    // This file is shared with www and docs. Unset, nothing about them changes.
    const client = await buildClient()

    expect(client.url).toBe('https://upstream.example.com/auth/v1')
    expect(client.headers?.apikey).toBeUndefined()
  })

  it('stays off when the variables are set but empty', async () => {
    // This is how an unset GitHub repo variable arrives: `${{ vars.X }}`
    // expands to an empty string rather than being absent. If empty counted as
    // configured, wiring the workflow would switch auth on by itself, before
    // anybody had chosen a project.
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_URL = ''
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_ANON_KEY = ''

    const client = await buildClient()

    expect(client.url).toBe('https://upstream.example.com/auth/v1')
    expect(client.headers?.apikey).toBeUndefined()
  })

  it('needs both halves before it switches', async () => {
    // Half-configured is the dangerous state: a URL with no key would point the
    // console at Taskclan and be refused on every request. Falling back is the
    // safe reading of an incomplete rollout.
    process.env.NEXT_PUBLIC_TASKCLAN_AUTH_URL = 'https://proj.supabase.co'

    expect((await buildClient()).url).toBe('https://upstream.example.com/auth/v1')
  })
})
