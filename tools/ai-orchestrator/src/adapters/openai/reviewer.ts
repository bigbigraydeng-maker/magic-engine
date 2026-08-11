/**
 * GPT reviewer adapter — safety skeleton for the Enable phase.
 *
 * v0.1 ships the guards, not the call. `createOpenAIReviewer` refuses to build a
 * provider without a key or with the kill switch off, and the provider it does
 * build refuses to run. That ordering matters: a misconfigured Enable attempt
 * must fail before it can spend money, not after.
 */

import { MissingSecretError, ProviderDisabledError, ProviderNotWiredError } from '../../domain/errors'
import { quoteWorstCase } from '../pricing'
import type { ModelPricing } from '../pricing'
import type {
  CostEstimateResult,
  CostQuery,
  ProviderCancellation,
  ProviderTurnResult,
  ReviewerProvider,
  TurnRequest,
} from '../provider-types'

export const OPENAI_API_KEY_SECRET = 'ME2_ORCHESTRATOR_OPENAI_API_KEY'
export const DEFAULT_REVIEWER_MODEL = 'gpt-5.6'

export interface OpenAIReviewerConfig {
  enabled: boolean
  apiKey?: string
  model?: string
  /** Required at Enable time. Absent means every quote is refused. */
  pricing?: ModelPricing
}

class OpenAIReviewerProvider implements ReviewerProvider {
  readonly name = 'openai-reviewer'

  /**
   * The OpenAI SDK accepts an AbortSignal and passes it to the underlying fetch,
   * so cancellation is real once the transport is wired. Until the transport
   * exists there is nothing to cancel, and claiming otherwise would let the runner
   * size its lease on a promise this adapter cannot yet keep.
   */
  readonly cancellation: ProviderCancellation = {
    supported: false,
    server_max_timeout_ms: 15 * 60_000,
  }

  constructor(private readonly config: Required<Omit<OpenAIReviewerConfig, 'enabled' | 'pricing'>> & { pricing?: ModelPricing }) {}

  maxCostFor(query: CostQuery): CostEstimateResult {
    return quoteWorstCase(this.config.pricing, query)
  }

  async review(_request: TurnRequest): Promise<ProviderTurnResult> {
    // The transport is intentionally absent in v0.1. Enabling it is a separate,
    // separately-reviewed change — see the Enable checklist in the spec.
    throw new ProviderNotWiredError(this.name)
  }
}

export type ReviewerFactoryResult =
  | { ok: true; provider: ReviewerProvider }
  | { ok: false; error: MissingSecretError | ProviderDisabledError }

/** Fail-closed factory: never returns a provider that could call out by accident. */
export function createOpenAIReviewer(config: OpenAIReviewerConfig): ReviewerFactoryResult {
  if (!config.enabled) {
    return { ok: false, error: new ProviderDisabledError('openai-reviewer') }
  }
  if (!config.apiKey) {
    return { ok: false, error: new MissingSecretError(OPENAI_API_KEY_SECRET) }
  }
  return {
    ok: true,
    provider: new OpenAIReviewerProvider({
      apiKey: config.apiKey,
      model: config.model ?? DEFAULT_REVIEWER_MODEL,
      pricing: config.pricing,
    }),
  }
}
