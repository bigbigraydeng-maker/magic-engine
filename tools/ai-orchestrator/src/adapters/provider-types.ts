/**
 * Provider contracts.
 *
 * Four rules encoded here, each of them the fix for something that was wrong
 * earlier in this PR:
 *
 * 1. **`output` is `unknown`.** The runner is the only place that validates a
 *    provider's output against its schema, so the check cannot be short-circuited
 *    by an adapter that types its own return value.
 * 2. **`telemetry` is not the model talking.** `tools_used` must come from the
 *    execution record — never from a field the model wrote.
 * 3. **cancellation is a declared capability, not an assumption.** `Promise.race`
 *    only abandons the local `await`; the request keeps running and keeps billing.
 *    A provider that cannot prove it cancels must say so, and the runner then
 *    sizes the claim to the provider's *server-side* maximum instead of pretending
 *    its own timeout is a wall.
 * 4. **cost is quoted before the call, by the adapter that knows the prices.** A
 *    flat reservation cannot be a ceiling for a model whose price the runner does
 *    not know.
 */

export interface ProviderUsage {
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

/**
 * Execution facts observed by the harness that ran the model.
 *
 * `source` is provenance and is written to the ledger, so a reviewer can see
 * whether a turn's tool list came from a real execution log or from nowhere.
 */
export interface ProviderTelemetry {
  tools_used: readonly string[]
  /** e.g. `claude-code-action:execution-log`, `openai:responses.tool_calls`, `mock:scripted`. */
  source: string
  /**
   * Set when the adapter observed the abort reaching the underlying call. The
   * runner records it; an adapter that cannot observe this must leave it false
   * and declare `cancellation.supported = false`.
   */
  abort_acknowledged?: boolean
}

/** Marks telemetry an adapter could not obtain. The runner refuses these turns. */
export const TELEMETRY_UNAVAILABLE = 'unavailable'

/**
 * Whether aborting actually stops the work — and what the worst case is when it
 * does not.
 */
export interface ProviderCancellation {
  /**
   * True only when the adapter passes the signal to the real API or child process
   * and can observe the cancellation. Guessing here is how a "hard timeout" turns
   * into two concurrent billed calls.
   */
  supported: boolean
  /**
   * How long the provider may keep running and billing after we stop waiting.
   * When `supported` is false this is the window the lease and claim must cover,
   * because our own timeout does not bound anything.
   */
  server_max_timeout_ms: number
}

export interface ProviderTurnResult {
  /** Unvalidated. The runner parses this with the actor's zod schema. */
  output: unknown
  usage: ProviderUsage
  model: string
  provider: string
  telemetry: ProviderTelemetry
}

// ─────────────────────────────────────────────────────────────────────────────
// Worst-case cost
// ─────────────────────────────────────────────────────────────────────────────

export interface CostEstimate {
  /** The most this call can possibly cost. The runner reserves exactly this. */
  max_cost_usd: number
  model: string
  /** Identifies the price table the number came from, so a stale quote is visible. */
  pricing_version: string
  input_tokens_estimate: number
  max_output_tokens: number
  /** Line items, e.g. `{ input: 0.012, output: 0.24, cache_write: 0.003, tools: 0.05 }`. */
  breakdown: Readonly<Record<string, number>>
}

export type CostEstimateFailure =
  | 'pricing_missing'
  | 'pricing_stale'
  | 'input_too_large'
  | 'model_unknown'

export type CostEstimateResult =
  | { ok: true; estimate: CostEstimate }
  | { ok: false; reason: CostEstimateFailure; message: string }

/** Everything needed to quote a call, before the reservation is known. */
export interface CostQuery {
  system: string
  user: string
  max_output_tokens: number
  now: Date
}

export interface TurnRequest {
  run_id: string
  round: number
  /** Built from code constants only — never contains untrusted text. */
  system: string
  user: string
  untrusted_sources: readonly string[]
  idempotency_key: string
  /** Digest of (system, user). Content-addressed half of duplicate detection. */
  input_digest: string
  /**
   * How long the runner will wait. Only a *hard* wall when
   * `cancellation.supported` is true; otherwise the provider may keep running for
   * up to `server_max_timeout_ms`, and the lease is sized for that instead.
   */
  timeout_ms: number
  /**
   * Aborted when `timeout_ms` elapses. A real adapter must pass this to the
   * underlying fetch / SDK / child process.
   */
  signal: AbortSignal
  /** Output-token ceiling. Must be passed to the API; it bounds the reservation. */
  max_output_tokens: number
  /** The worst-case dollars reserved for this call, from `maxCostFor`. */
  reserved_cost_usd: number
  /** The quote the reservation came from, recorded in the ledger. */
  cost_estimate: CostEstimate
}

interface ProviderBase {
  readonly name: string
  readonly cancellation: ProviderCancellation
  /** Quote the worst case. Returning `ok: false` means the runner must not call. */
  maxCostFor(query: CostQuery): CostEstimateResult
}

export interface ReviewerProvider extends ProviderBase {
  review(request: TurnRequest): Promise<ProviderTurnResult>
}

export interface ImplementerProvider extends ProviderBase {
  implement(request: TurnRequest): Promise<ProviderTurnResult>
}

export const ZERO_USAGE: ProviderUsage = { input_tokens: 0, output_tokens: 0, cost_usd: 0 }
