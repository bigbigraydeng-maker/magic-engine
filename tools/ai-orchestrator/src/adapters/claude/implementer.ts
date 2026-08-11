/**
 * Claude implementer adapter — safety skeleton for the Enable phase.
 *
 * Decision (see docs/specs/2026-08-07-ai-orchestrator-v0.1.md §5): the Enable
 * phase drives Claude through `anthropics/claude-code-action@v1` inside the
 * runner, not through a bespoke SDK loop. The Action already owns git identity,
 * token exchange, tool sandboxing, `max_turns` and `timeout_minutes`; re-writing
 * those is exactly the wrong thing to hand-roll. The orchestrator core only ever
 * sees this interface, so swapping to the SDK later is a one-file change.
 *
 * v0.1 ships the guards, not the call.
 */

import { MissingSecretError, ProviderDisabledError, ProviderNotWiredError } from '../../domain/errors'
import { quoteWorstCase } from '../pricing'
import type { ModelPricing } from '../pricing'
import type {
  CostEstimateResult,
  CostQuery,
  ImplementerProvider,
  ProviderCancellation,
  ProviderTurnResult,
  TurnRequest,
} from '../provider-types'

export const ANTHROPIC_API_KEY_SECRET = 'ME2_ORCHESTRATOR_ANTHROPIC_API_KEY'
export const DEFAULT_IMPLEMENTER_MODEL = 'claude-opus-5'

/**
 * Moved to `policy/policy.ts`, which is where it is actually enforced.
 *
 * It lived here with a comment saying `enforceToolUse` applied it, and nothing
 * read it — an adapter is the wrong home for a rule the policy layer has to
 * apply, because the two drift and only one of them is consulted.
 */
export { NEVER_ALLOWED_TOOLS } from '../../policy/policy'

export interface ClaudeImplementerConfig {
  enabled: boolean
  apiKey?: string
  model?: string
  allowedTools?: readonly string[]
  maxTurns?: number
  timeoutMinutes?: number
  /** Required at Enable time. Absent means every quote is refused. */
  pricing?: ModelPricing
}

class ClaudeCodeActionProvider implements ImplementerProvider {
  readonly name = 'claude-code-action'

  /**
   * `claude-code-action` runs as a separate process inside the runner. Aborting
   * our await does not signal that process, and nothing here yet proves the
   * process is killed and the API request cancelled. Until an adapter can
   * demonstrate that — kill the child, observe the exit, confirm the request was
   * torn down — this must stay false, and the runner will size the lease to
   * `server_max_timeout_ms` rather than to its own timeout.
   */
  readonly cancellation: ProviderCancellation = {
    supported: false,
    server_max_timeout_ms: 30 * 60_000,
  }

  constructor(
    private readonly config: Required<Omit<ClaudeImplementerConfig, 'enabled' | 'pricing'>> & {
      pricing?: ModelPricing
    }
  ) {}

  maxCostFor(query: CostQuery): CostEstimateResult {
    return quoteWorstCase(this.config.pricing, query)
  }

  async implement(_request: TurnRequest): Promise<ProviderTurnResult> {
    throw new ProviderNotWiredError(this.name)
  }
}

export type ImplementerFactoryResult =
  | { ok: true; provider: ImplementerProvider }
  | { ok: false; error: MissingSecretError | ProviderDisabledError }

/** Fail-closed factory. */
export function createClaudeImplementer(
  config: ClaudeImplementerConfig
): ImplementerFactoryResult {
  if (!config.enabled) {
    return { ok: false, error: new ProviderDisabledError('claude-code-action') }
  }
  if (!config.apiKey) {
    return { ok: false, error: new MissingSecretError(ANTHROPIC_API_KEY_SECRET) }
  }
  return {
    ok: true,
    provider: new ClaudeCodeActionProvider({
      apiKey: config.apiKey,
      model: config.model ?? DEFAULT_IMPLEMENTER_MODEL,
      allowedTools: config.allowedTools ?? [],
      maxTurns: config.maxTurns ?? 12,
      timeoutMinutes: config.timeoutMinutes ?? 20,
      pricing: config.pricing,
    }),
  }
}
