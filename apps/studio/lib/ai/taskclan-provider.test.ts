import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assistantProvider,
  taskclanBaseUrl,
  taskclanConfig,
  taskclanConfigured,
} from './taskclan-provider'

/**
 * Routing Studio's assistant to Taskclan Intelligence.
 *
 * The behaviour worth pinning is the fallback. Ten AI endpoints now ask
 * assistantProvider() instead of naming OpenAI, so if this ever throws or
 * returns something unexpected when a key is absent, the whole assistant stops
 * — and it stops in a fork whose value depends on staying rebaseable against
 * upstream.
 */

const ENV = ['TASKCLAN_INTELLIGENCE_API_KEY', 'TASKCLAN_INTELLIGENCE_URL'] as const
let saved: Record<string, string | undefined> = {}
const KEY = 'sk_t1_' + 'a'.repeat(48)

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('assistantProvider', () => {
  it('falls back to OpenAI when Taskclan is not configured', () => {
    // The important one: an unconfigured fork must still have a working
    // assistant, or nobody keeps rebasing it.
    expect(assistantProvider()).toBe('openai')
  })

  it('prefers Taskclan once a key is present', () => {
    process.env.TASKCLAN_INTELLIGENCE_API_KEY = KEY
    expect(assistantProvider()).toBe('taskclan')
  })

  it('is read per call, so a key added at deploy time takes effect', () => {
    // A module-level constant would have captured 'openai' at import and kept
    // returning it for the life of the process.
    expect(assistantProvider()).toBe('openai')
    process.env.TASKCLAN_INTELLIGENCE_API_KEY = KEY
    expect(assistantProvider()).toBe('taskclan')
  })
})

describe('taskclanConfig', () => {
  it('reports the absence rather than just failing', () => {
    const r = taskclanConfig()
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('TASKCLAN_INTELLIGENCE_API_KEY')
    expect(taskclanConfigured()).toBe(false)
  })

  it('rejects a key that is not a T1 key', () => {
    // The likely pastes are a Cloud key or an OpenAI key — both long, both
    // plausible, both a 401 much later otherwise.
    for (const bad of ['sk_cloud_' + 'b'.repeat(48), 'sk-proj-abcdef', 'eyJhbGciOiJIUzI1NiJ9.x.y']) {
      process.env.TASKCLAN_INTELLIGENCE_API_KEY = bad
      const r = taskclanConfig()
      expect(r.ok, bad).toBe(false)
      expect((r as { reason: string }).reason).toContain('sk_t1_')
    }
  })

  it('accepts a T1 key', () => {
    process.env.TASKCLAN_INTELLIGENCE_API_KEY = KEY
    const r = taskclanConfig()
    expect(r.ok).toBe(true)
    expect((r as { config: { apiKey: string } }).config.apiKey).toBe(KEY)
  })
})

describe('taskclanBaseUrl', () => {
  it('defaults to the production engine', () => {
    // Studio is itself deployed on Cloud, so one Taskclan service calling
    // another is the common case — not localhost.
    expect(taskclanBaseUrl()).toBe('https://engine.taskclan.com/api/openai/v1')
  })

  it('honours an override and does not double the slash', () => {
    process.env.TASKCLAN_INTELLIGENCE_URL = 'http://localhost:9119/'
    expect(taskclanBaseUrl()).toBe('http://localhost:9119/api/openai/v1')
  })
})
