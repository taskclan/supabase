/**
 * Taskclan Intelligence as an AI SDK provider.
 *
 * The engine already exposes an OpenAI-shaped surface at
 * `/api/openai/v1/chat/completions` — built so Cursor, Continue and aider could
 * point at it — which means Studio's assistant needs a base URL and a key, not
 * an adapter. Nothing here translates protocols; `@ai-sdk/openai` talks to
 * Taskclan the same way it talks to OpenAI.
 *
 * Two things follow from using Taskclan rather than OpenAI directly, and both
 * are the point:
 *
 *  - Spend lands in the Cloud credit ledger. The endpoint runs every call
 *    through callTierMetered and logCreditLedgerAsync, so assistant usage
 *    appears beside deploy and container spend instead of on a separate
 *    invoice nobody reconciles.
 *  - Routing is Taskclan's. `T1-auto` picks a tier per request; the explicit
 *    tiers stay available for a caller that wants to pin cost or capability.
 *
 * The engine accepts OpenAI and Anthropic model ids by capability too, so an
 * existing `gpt-4o` config keeps working — but Studio names the tiers
 * explicitly, because a model id that silently means something else is how a
 * cost ceiling gets crossed without anyone choosing to.
 */
import { createOpenAI } from '@ai-sdk/openai'

/** The tiers the engine advertises at /api/openai/v1/models. */
export type TaskclanModelId = 'T1-auto' | 'T1-core' | 'T1-flow' | 'T1-max'

export const TASKCLAN_DEFAULT_MODEL: TaskclanModelId = 'T1-auto'

/**
 * Where the engine lives.
 *
 * Defaults to production rather than localhost: Studio is itself deployed on
 * Cloud, so the common case is one Taskclan service calling another. Override
 * for local work against a dev engine.
 */
export function taskclanBaseUrl(): string {
  const raw = process.env.TASKCLAN_INTELLIGENCE_URL?.trim() || 'https://engine.taskclan.com'
  return `${raw.replace(/\/+$/, '')}/api/openai/v1`
}

export interface TaskclanConfig {
  baseURL: string
  apiKey: string
}

const KEY_PREFIX = 'sk_t1_'

/**
 * Read the credentials, or say precisely why there are none.
 *
 * A reason rather than null so getModel can surface it. "Assistant is
 * unavailable" with no cause is the kind of message that gets rediscovered
 * once a quarter.
 */
export function taskclanConfig():
  | { ok: true; config: TaskclanConfig }
  | { ok: false; reason: string } {
  const apiKey = process.env.TASKCLAN_INTELLIGENCE_API_KEY?.trim()
  if (!apiKey) return { ok: false, reason: 'TASKCLAN_INTELLIGENCE_API_KEY is not set' }
  if (!apiKey.startsWith(KEY_PREFIX)) {
    // The likely paste is a Cloud key (sk_cloud_) or an OpenAI key. Both are
    // long and plausible, and both would fail as a 401 much later, by which
    // time nobody remembers which one went in.
    return {
      ok: false,
      reason: `TASKCLAN_INTELLIGENCE_API_KEY does not look like a T1 key (expected ${KEY_PREFIX}…)`,
    }
  }
  return { ok: true, config: { baseURL: taskclanBaseUrl(), apiKey } }
}

export function taskclanConfigured(): boolean {
  return taskclanConfig().ok
}

/**
 * An AI SDK model backed by Taskclan Intelligence.
 *
 * `.chat()`, not `provider(id)`. This version of @ai-sdk/openai defaults the
 * callable form to OpenAI's newer *Responses* API and requests
 * `/v1/responses`; the engine implements `/v1/chat/completions` only, so the
 * default produced a 404 that arrived as an HTML page rather than an API
 * error. `.chat()` pins the completions transport.
 *
 * No `compatibility` flag: this version does not take one, and the engine
 * accepts the fields the SDK sends anyway — every sub-schema there is
 * `.passthrough()`, precisely so editor clients can layer their own on top.
 */
export function taskclanModel(modelId: TaskclanModelId = TASKCLAN_DEFAULT_MODEL) {
  const cfg = taskclanConfig()
  if (!cfg.ok) throw new Error(cfg.reason)
  const provider = createOpenAI({
    baseURL: cfg.config.baseURL,
    apiKey: cfg.config.apiKey,
    name: 'taskclan',
  })
  return provider.chat(modelId)
}

/**
 * Which provider the assistant should use.
 *
 * Taskclan Intelligence when it is configured, OpenAI otherwise. Expressed as
 * a function rather than a constant so a key added at deploy time takes effect
 * without a rebuild, and so the ten call sites that used to hardcode
 * `provider: 'openai'` now all ask the same question.
 *
 * Falling back rather than failing is deliberate: an upstream rebase brings
 * new AI endpoints that will call this, and a fork that breaks Studio's
 * assistant whenever a Taskclan key is missing is a fork people stop rebasing.
 */
export function assistantProvider(): 'taskclan' | 'openai' {
  return taskclanConfigured() ? 'taskclan' : 'openai'
}
