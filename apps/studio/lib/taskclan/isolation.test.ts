import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { taskclanConfig, operatorTaskclanConfig } from './client'
import { taskclanOrg, resetOrgCache } from './org'
import { runWithCloudSession, type CloudSession } from './session'

/**
 * Multi-tenant isolation — the property the whole signup phase turns on.
 *
 * When self-serve signup is on, every Cloud call must use the CALLER'S own
 * per-session org key, and a caller with no session must get nothing — never
 * the global operator key, which resolves to one org and would serve one
 * customer another's apps. These are tested rather than reviewed because the
 * failure does not throw: it renders the wrong org's dashboard.
 */

const ENV = ['TASKCLAN_CLOUD_URL', 'TASKCLAN_CLOUD_API_KEY', 'CLOUD_WEB_SIGNUP_ENABLED'] as const
let saved: Record<string, string | undefined> = {}

const OPERATOR_KEY = 'sk_cloud_' + 'g'.repeat(48)
const SESSION_A: CloudSession = { key: 'sk_cloud_' + 'a'.repeat(48), orgId: 'org-aaaa', orgName: "Ada's workspace" }
const SESSION_B: CloudSession = { key: 'sk_cloud_' + 'b'.repeat(48), orgId: 'org-bbbb', orgName: "Ben's workspace" }

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  process.env.TASKCLAN_CLOUD_URL = 'https://engine.taskclan.com'
  process.env.TASKCLAN_CLOUD_API_KEY = OPERATOR_KEY
  delete process.env.CLOUD_WEB_SIGNUP_ENABLED
  resetOrgCache()
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetOrgCache()
})

describe('with signup ENABLED (multi-tenant)', () => {
  beforeEach(() => {
    process.env.CLOUD_WEB_SIGNUP_ENABLED = 'true'
  })

  it('fails closed with no session — never the operator key', () => {
    const r = taskclanConfig()
    expect(r.ok).toBe(false)
    // The point: no session must not silently become the operator's org.
    expect(JSON.stringify(r)).not.toContain(OPERATOR_KEY)
  })

  it('uses each caller’s own session key', () => {
    const a = runWithCloudSession(SESSION_A, () => taskclanConfig())
    const b = runWithCloudSession(SESSION_B, () => taskclanConfig())
    expect(a).toMatchObject({ ok: true, config: { key: SESSION_A.key } })
    expect(b).toMatchObject({ ok: true, config: { key: SESSION_B.key } })
    // And never the operator key, even though it is set in the environment.
    expect((a as { config: { key: string } }).config.key).not.toBe(OPERATOR_KEY)
    expect((b as { config: { key: string } }).config.key).not.toBe(OPERATOR_KEY)
  })

  it('resolves each caller’s own org from their session — no shared cache', async () => {
    const a = await runWithCloudSession(SESSION_A, () => taskclanOrg())
    const b = await runWithCloudSession(SESSION_B, () => taskclanOrg())
    expect(a).toMatchObject({ ok: true, data: { uuid: 'org-aaaa', name: "Ada's workspace" } })
    // The regression this guards: B must NOT inherit A's org from a process cache.
    expect(b).toMatchObject({ ok: true, data: { uuid: 'org-bbbb', name: "Ben's workspace" } })
  })

  it('rejects a session whose key is not a Cloud key', () => {
    const bad: CloudSession = { key: 'not-a-cloud-key', orgId: 'org-x' }
    const r = runWithCloudSession(bad, () => taskclanConfig())
    expect(r.ok).toBe(false)
  })
})

describe('with signup DISABLED (single-tenant, unchanged)', () => {
  it('uses the global operator key regardless of any session', () => {
    const r = runWithCloudSession(SESSION_A, () => taskclanConfig())
    expect(r).toMatchObject({ ok: true, config: { key: OPERATOR_KEY } })
  })

  it('operatorTaskclanConfig is the explicit global-key escape hatch', () => {
    const r = operatorTaskclanConfig()
    expect(r).toMatchObject({ ok: true, config: { key: OPERATOR_KEY } })
  })
})
