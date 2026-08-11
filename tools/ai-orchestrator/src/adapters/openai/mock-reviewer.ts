/**
 * Scripted reviewer for tests and dry-runs. Never touches the network.
 *
 * Outputs are `unknown` on purpose so a test can feed schema-invalid data and
 * prove the runner refuses to advance on it. `telemetry` is scripted separately
 * from `output` for the same reason the real adapter keeps them apart: a test
 * must be able to make the model claim one thing while the record says another.
 *
 * The abort handling is real, not simulated: a delayed step actually listens to
 * `request.signal` and rejects when it fires, so "the adapter received the
 * cancellation" is something the tests observe rather than assume.
 */

import { MOCK_PRICING, quoteWorstCase } from '../pricing'
import type { ModelPricing } from '../pricing'
import type {
  CostEstimateResult,
  CostQuery,
  ProviderCancellation,
  ProviderTelemetry,
  ProviderTurnResult,
  ProviderUsage,
  ReviewerProvider,
  TurnRequest,
} from '../provider-types'

const MODEL = 'mock-gpt'

export interface MockReviewerStep {
  output: unknown
  usage?: Partial<ProviderUsage>
  telemetry?: Partial<ProviderTelemetry>
  /** Milliseconds to "spend" before returning. Used to exercise the hard timeout. */
  delayMs?: number
  /** Throw instead of returning, to exercise the provider-error path. */
  throws?: string
}

export interface MockReviewerOptions {
  cancellation?: Partial<ProviderCancellation>
  /** `null` means "no price table entry", to exercise the refusal path. */
  pricing?: ModelPricing | null
}

const DEFAULT_USAGE: ProviderUsage = { input_tokens: 1200, output_tokens: 400, cost_usd: 0.05 }
const DEFAULT_TELEMETRY: ProviderTelemetry = { tools_used: [], source: 'mock:scripted' }

export class MockReviewerProvider implements ReviewerProvider {
  readonly name = 'mock-reviewer'
  readonly requests: TurnRequest[] = []
  readonly cancellation: ProviderCancellation

  callCount = 0
  abortObserved = false

  private readonly pricingOverride: ModelPricing | null | undefined

  constructor(
    private readonly script: readonly MockReviewerStep[],
    options?: MockReviewerOptions
  ) {
    this.cancellation = {
      supported: true,
      server_max_timeout_ms: 10 * 60_000,
      ...options?.cancellation,
    }
    this.pricingOverride = options?.pricing
  }

  maxCostFor(query: CostQuery): CostEstimateResult {
    if (this.pricingOverride === null) return quoteWorstCase(undefined, query)
    return quoteWorstCase(this.pricingOverride ?? MOCK_PRICING[MODEL], query)
  }

  async review(request: TurnRequest): Promise<ProviderTurnResult> {
    this.requests.push(request)
    const step = this.script[Math.min(this.callCount, this.script.length - 1)]
    this.callCount += 1

    if (!step) throw new Error('MockReviewerProvider was called with an empty script')
    if (step.delayMs) await this.sleepUnlessAborted(step.delayMs, request.signal)
    if (step.throws) throw new Error(step.throws)

    return {
      output: step.output,
      usage: { ...DEFAULT_USAGE, ...step.usage },
      model: MODEL,
      provider: this.name,
      telemetry: {
        ...DEFAULT_TELEMETRY,
        abort_acknowledged: this.abortObserved,
        ...step.telemetry,
      },
    }
  }

  /** Mirrors what a real adapter must do: pass the signal down and honour it. */
  private sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          this.abortObserved = true
          reject(new Error('aborted by caller'))
        },
        { once: true }
      )
    })
  }
}
