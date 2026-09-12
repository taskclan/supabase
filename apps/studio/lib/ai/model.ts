import { openai } from '@ai-sdk/openai'

import { taskclanConfig, taskclanModel, type TaskclanModelId } from './taskclan-provider'
import { LanguageModel } from 'ai'

import { checkAwsCredentials, createRoutedBedrock } from './bedrock'
import {
  BedrockModel,
  getDefaultModelForProvider,
  Model,
  OpenAIModelEntry,
  OpenAIModelId,
  ProviderModelConfig,
  PROVIDERS,
} from './model.utils'

type ProviderOptions = Record<string, any>
type SystemProviderOptions = Record<string, any>

type ModelSuccess = {
  /** Spread directly into AI SDK calls: `streamText({ ...modelParams, ... })` */
  modelParams: { model: LanguageModel; providerOptions?: ProviderOptions }
  systemProviderOptions?: SystemProviderOptions
  error?: never
}

export type ModelError = {
  modelParams?: never
  systemProviderOptions?: never
  error: Error
}

type ModelResponse = ModelSuccess | ModelError

export type GetModelParams =
  | {
      provider: 'taskclan'
      /**
       * Accepted and ignored.
       *
       * Call sites pick the provider at runtime via assistantProvider() while
       * still passing the OpenAI entry they were written with, so this arm has
       * to admit one. Taskclan chooses its tier by name and T1-auto routes per
       * request — an OpenAI reasoning-effort setting has nothing to say about
       * that, and silently honouring it would override the routing.
       */
      modelEntry?: OpenAIModelEntry
    }
  | {
      provider: 'openai'
      /**
       * Specifies which OpenAI model to use and its reasoning effort.
       * Create entries via `openaiModelEntry()` — reasoning effort is validated against the model
       * at compile time. Use `DEFAULT_COMPLETION_MODEL` for simple endpoints (minimal reasoning).
       * Callers are responsible for resolving the correct entry (including throttling/entitlement
       * fallbacks) before calling getModel.
       */
      modelEntry: OpenAIModelEntry
    }
  | {
      provider: 'bedrock'
      /** Used for consistent hashing across Bedrock regions. */
      routingKey: string
    }

/**
 * Retrieves a LanguageModel from a specific provider and model entry.
 * Callers are responsible for resolving the correct model entry (including throttling/entitlement
 * fallbacks) before calling this function.
 * Returns systemProviderOptions that callers can attach to the system message.
 */
export async function getModel(params: GetModelParams): Promise<ModelResponse> {
  const { provider } = params

  const providerRegistry = PROVIDERS[provider]
  if (!providerRegistry) {
    return { error: new Error(`Unknown provider: ${provider}`) }
  }

  const models = providerRegistry.models as Record<Model, ProviderModelConfig>
  const modelEntry = params.provider === 'openai' ? params.modelEntry : undefined

  const useDefault = !modelEntry?.id || !models[modelEntry.id]

  const chosenModelId = useDefault ? getDefaultModelForProvider(provider) : modelEntry?.id

  if (provider === 'bedrock') {
    const hasAwsCredentials = await checkAwsCredentials()
    const hasAwsBedrockRoleArn = !!process.env.AWS_BEDROCK_ROLE_ARN
    if (!hasAwsBedrockRoleArn || !hasAwsCredentials) {
      return { error: new Error('AWS Bedrock credentials not available') }
    }
    const bedrock = createRoutedBedrock(params.routingKey)
    const model = await bedrock(chosenModelId as BedrockModel)
    const systemProviderOptions = (
      providerRegistry.models as Record<BedrockModel, ProviderModelConfig>
    )[chosenModelId as BedrockModel]?.systemProviderOptions
    return { modelParams: { model }, systemProviderOptions }
  }

  if (provider === 'taskclan') {
    const cfg = taskclanConfig()
    // Surface the reason rather than a bare "unavailable" — see the note in
    // taskclan-provider.ts about which key people actually paste.
    if (!cfg.ok) return { error: new Error(cfg.reason) }
    return {
      modelParams: { model: taskclanModel(chosenModelId as TaskclanModelId) },
      systemProviderOptions: models[chosenModelId as TaskclanModelId]?.systemProviderOptions,
    }
  }

  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      return { error: new Error('OPENAI_API_KEY not available') }
    }
    const baseProviderOptions = providerRegistry.providerOptions?.openai ?? {}
    const openaiProviderOptions = modelEntry?.reasoningEffort
      ? { ...baseProviderOptions, reasoningEffort: modelEntry.reasoningEffort }
      : baseProviderOptions
    return {
      modelParams: {
        model: openai(chosenModelId as OpenAIModelId),
        providerOptions: { openai: openaiProviderOptions },
      },
      systemProviderOptions: models[chosenModelId as OpenAIModelId]?.systemProviderOptions,
    }
  }

  return { error: new Error(`Unsupported provider: ${provider}`) }
}
