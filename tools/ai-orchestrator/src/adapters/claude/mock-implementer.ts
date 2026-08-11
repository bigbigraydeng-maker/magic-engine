/**
 * Scripted implementer for tests and dry-runs. Never touches the network and
 * never touches the working tree.
 *
 * `sideEffects` is the positive control for the dry-run tests: a real (non
 * dry-run) pass records simulated commits here, so asserting the list is empty in
 * dry-run distinguishes "the provider was never called" from "the provider was
 * called but happened to do nothing".
 *
 * `telemetry` is scripted independently of `output` so a test can make the model
 * under-report the tools it used and prove the authoritative record still catches
 * it. That separation is the whole point of the interface.
 */

import { MOCK_PRICING, quoteWorstCase } from '../pricing'
import type { ModelPricing } from '../pricing'
import type {
  CostEstimateResult,
  CostQuery,
  ImplementerProvider,
  ProviderCancellation,
  ProviderTelemetry,
  ProviderTurnResult,
  ProviderUsage,
  TurnRequest,
} from '../provider-types'

const MODEL = 'mock-claude'

export interface MockImplementerStep {
  output: unknown
  usage?: Partial<ProviderUsage>
  telemetry?: Partial<ProviderTelemetry>
  delayMs?: number
  throws?: string
}

export interface MockImplementerOptions {
  cancellation?: Partial<ProviderCancellation>
  /** `null` means "no price table entry", to exercise the refusal path. */
  pricing?: ModelPricing | null
}

export interface SimulatedSideEffect {
  kind: 'commit' | 'push' | 'open_draft_pr'
  ref: string
}

const DEFAULT_USAGE: ProviderUsage = { input_tokens: 4000, output_tokens: 1500, cost_usd: 0.2 }
const DEFAULT_TELEMETRY: ProviderTelemetry = {
  tools_used: ['Read', 'Edit'],
  source: 'mock:execution-log',
}

interface CommitEvidenceShape {
  branch?: unknown
  commit_sha?: unknown
  pr_number?: unknown
}

function readCommitEvidence(output: unknown): CommitEvidenceShape | null {
  if (typeof output !== 'object' || output === null) return null
  const evidence = (output as { commit_evidence?: unknown }).commit_evidence
  if (typeof evidence !== 'object' || evidence === null) return null
  return evidence as CommitEvidenceShape
}

export class MockImplementerProvider implements ImplementerProvider {
  readonly name = 'mock-implementer'
  readonly requests: TurnRequest[] = []
  readonly sideEffects: SimulatedSideEffect[] = []

  readonly cancellation: ProviderCancellation

  callCount = 0
  abortObserved = false

  private readonly pricingOverride: ModelPricing | null | undefined

  constructor(
    private readonly script: readonly MockImplementerStep[],
    options?: MockImplementerOptions
  ) {
    this.cancellation = {
      supported: true,
      server_max_timeout_ms: 30 * 60_000,
      ...options?.cancellation,
    }
    this.pricingOverride = options?.pricing
  }

  maxCostFor(query: CostQuery): CostEstimateResult {
    if (this.pricingOverride === null) return quoteWorstCase(undefined, query)
    return quoteWorstCase(this.pricingOverride ?? MOCK_PRICING[MODEL], query)
  }

  async implement(request: TurnRequest): Promise<ProviderTurnResult> {
    this.requests.push(request)
    const step = this.script[Math.min(this.callCount, this.script.length - 1)]
    this.callCount += 1

    if (!step) throw new Error('MockImplementerProvider was called with an empty script')
    if (step.delayMs) await this.sleepUnlessAborted(step.delayMs, request.signal)
    if (step.throws) throw new Error(step.throws)

    this.recordSideEffects(step.output)

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

  private recordSideEffects(output: unknown): void {
    const evidence = readCommitEvidence(output)
    if (!evidence) return

    if (typeof evidence.commit_sha === 'string') {
      this.sideEffects.push({ kind: 'commit', ref: evidence.commit_sha })
    }
    if (typeof evidence.branch === 'string') {
      this.sideEffects.push({ kind: 'push', ref: evidence.branch })
    }
    if (typeof evidence.pr_number === 'number') {
      this.sideEffects.push({ kind: 'open_draft_pr', ref: String(evidence.pr_number) })
    }
  }
}
