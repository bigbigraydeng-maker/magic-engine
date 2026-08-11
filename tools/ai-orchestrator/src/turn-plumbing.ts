/**
 * The mechanics of making one provider call and writing down what it cost.
 *
 * Everything here is actor-agnostic: the abort-backed invocation, the rejection
 * record, the conflict re-check, the cost reconciliation, and the assembly of the
 * authoritative record of a turn. `turn-executor.ts` holds what differs between
 * the reviewer and the implementer; this holds what must not.
 *
 * Split out of `turn-executor.ts` when that file crossed the 800-line house
 * limit. The seam is deliberate rather than arbitrary — "one call's mechanics"
 * against "the two turns" — but nothing moved semantically in the split.
 */

import { hasTurnBeenProcessed } from './adapters/github/ledger'
import type {
  ProviderTelemetry,
  ProviderTurnResult,
  TurnRequest,
} from './adapters/provider-types'
import { TELEMETRY_UNAVAILABLE } from './adapters/provider-types'
import type { TurnDelta } from './adapters/workspace/inspector'
import { computeBudgetLedger } from './domain/budget'
import type {
  Actor,
  AuthoritativeTurnFacts,
  RunState,
  StopReason,
  TurnRejectionReason,
  WaitDescriptor,
} from './domain/schema'
import { applyTurnState, baseEvent, nextWaitId, record } from './runner-context'
import type { RunnerContext } from './runner-types'
import { providerFor } from './turn-executor'

// ─────────────────────────────────────────────────────────────────────────────
// Rejection
// ─────────────────────────────────────────────────────────────────────────────

export async function rejectTurn(
  ctx: RunnerContext,
  args: {
    actor: Actor
    round: number
    request: TurnRequest
    reason: TurnRejectionReason
    detail: string[]
    /** Where the run lands. Same state means "try again"; WAITING_HUMAN means stop. */
    nextState: RunState
    /** What this rejection settles. A timeout settles at the full reservation. */
    costUsd: number
  }
): Promise<void> {
  // Landing on WAITING_HUMAN opens a *named* block. The human authorization that
  // releases it must name this id, so an approval given for an earlier gate
  // cannot silently clear this one.
  const wait: WaitDescriptor | null =
    args.nextState === 'WAITING_HUMAN'
      ? { id: nextWaitId(ctx), blocking_reason: args.reason }
      : null

  ctx.run = {
    ...ctx.run,
    current_round: args.round,
    invalid_output_count:
      ctx.run.invalid_output_count + (args.reason === 'invalid_output' ? 1 : 0),
  }
  const nextState = applyTurnState(ctx, args.nextState)
  await record(ctx, {
    ...baseEvent(ctx),
    event: 'turn_rejected',
    actor: args.actor,
    round: args.round,
    idempotency_key: args.request.idempotency_key,
    input_digest: args.request.input_digest,
    reason: args.reason,
    detail: args.detail,
    wait,
    reserved_cost_usd: args.request.reserved_cost_usd,
    cost_usd: args.costUsd,
    next_state: nextState,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider invocation
// ─────────────────────────────────────────────────────────────────────────────

export class ProviderTimeoutError extends Error {
  constructor(ms: number) {
    super(`provider call exceeded its ${ms}ms timeout and was aborted`)
    this.name = 'ProviderTimeoutError'
  }
}

/**
 * Runs a provider call with a real cancellation signal.
 *
 * v0.2 used `Promise.race` alone and called it a hard timeout. It was not: losing
 * the race only abandons the local `await`, while the HTTP request keeps running
 * and keeps billing. Now an `AbortController` fires, the adapter is contractually
 * required to pass the signal down, and `cancellation.supported` says whether that
 * is actually believed — the runner sizes its lease on the answer.
 */
async function callWithAbort(
  call: (signal: AbortSignal) => Promise<ProviderTurnResult>,
  timeoutMs: number
): Promise<ProviderTurnResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await call(controller.signal)
  } catch (error) {
    if (timedOut) throw new ProviderTimeoutError(timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Telemetry an adapter could not actually observe is not evidence of compliance. */
function telemetryUsable(result: ProviderTurnResult): boolean {
  return (
    !!result.telemetry &&
    typeof result.telemetry.source === 'string' &&
    result.telemetry.source.length > 0 &&
    result.telemetry.source !== TELEMETRY_UNAVAILABLE &&
    Array.isArray(result.telemetry.tools_used)
  )
}

export function checkTelemetry(result: ProviderTurnResult): string | null {
  if (telemetryUsable(result)) return null
  return `provider "${result.provider}" returned no usable execution telemetry (source: ${
    result.telemetry?.source ?? 'absent'
  }); tool use cannot be verified`
}

type InvokeOutcome =
  | { ok: ProviderTurnResult }
  | { failed: { timedOut: boolean; message: string } }

export async function invokeProvider(
  call: (signal: AbortSignal) => Promise<ProviderTurnResult>,
  request: TurnRequest
): Promise<InvokeOutcome> {
  try {
    const result = await callWithAbort(call, request.timeout_ms)
    return { ok: result }
  } catch (error) {
    const timedOut = error instanceof ProviderTimeoutError
    return {
      failed: { timedOut, message: error instanceof Error ? error.message : String(error) },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcomes
// ─────────────────────────────────────────────────────────────────────────────

export type TurnOutcome =
  | { kind: 'advanced' }
  /** The turn already recorded where the run landed; the loop just has to stop. */
  | {
      kind: 'halted'
      stop_reason: StopReason
      message: string
      /**
       * Set when we stopped waiting on a provider that cannot prove it cancels.
       * The call may still be running, writing and billing, so the runner must
       * hold its lease instead of freeing the concurrency group. See runner.ts.
       */
      in_flight_risk?: { reason: string }
    }
  | { kind: 'retry' }
  /** Another runner recorded this turn while we were waiting on the model. */
  | { kind: 'conflict'; message: string }

/**
 * Compare-and-set before recording a turn.
 *
 * With the reservation claim in place this should be unreachable in practice —
 * the claim is written before the call, so a rival sees it and never starts.
 * It stays as the last net for a ledger read that was already stale when the
 * claim was written.
 */
export async function turnClaimedElsewhere(ctx: RunnerContext, request: TurnRequest): Promise<boolean> {
  const fresh = await ctx.ledger.read()
  if (!hasTurnBeenProcessed(fresh.events, request.idempotency_key)) return false
  ctx.events = [...fresh.events]
  ctx.budget = computeBudgetLedger(ctx.events, ctx.run.run_id, ctx.clock.now())
  return true
}

/**
 * We lost the race after paying for the answer.
 *
 * The reservation claim makes this rare — a compliant runner sees the claim and
 * never starts — but it is not impossible, and silently dropping the result would
 * drop the cost with it. The event carries no state, so the winner's transition
 * stands; it exists purely so the money shows up in the ledger and against the cap.
 */
export async function recordDuplicateSpend(
  ctx: RunnerContext,
  actor: Actor,
  round: number,
  request: TurnRequest,
  costUsd: number
): Promise<TurnOutcome> {
  await record(ctx, {
    ...baseEvent(ctx),
    event: 'duplicate_spend_recorded',
    actor,
    round,
    idempotency_key: request.idempotency_key,
    holder: ctx.input.holder,
    cost_usd: costUsd,
    note: 'another runner recorded this turn first; our result was discarded but the call was billed',
  })
  return {
    kind: 'conflict',
    message: `turn ${request.idempotency_key} was recorded by another runner`,
  }
}

/**
 * A call that timed out or threw still settles at the full reservation: we do not
 * know whether the provider billed us, and guessing in our own favour is how a
 * cap becomes a suggestion.
 *
 * It also reports whether the call might still be alive. When the adapter cannot
 * prove it cancels, abandoning our `await` abandons nothing: the model keeps
 * running, may keep writing to the repository, and keeps billing. Both real
 * adapters declare `cancellation.supported = false` today, so this is the normal
 * case rather than the exotic one, and the flag is set for a thrown error as well
 * as a timeout — a rejected promise tells us our side gave up, not that the other
 * side stopped.
 */
export async function handleProviderFailure(
  ctx: RunnerContext,
  actor: Actor,
  round: number,
  request: TurnRequest,
  failure: { timedOut: boolean; message: string }
): Promise<TurnOutcome> {
  const provider = providerFor(ctx, actor)
  const stillRunning = !provider.cancellation.supported
  const cancellationNote = stillRunning
    ? `provider does not support cancellation — it may keep running and billing for up to ${provider.cancellation.server_max_timeout_ms}ms`
    : 'abort signal delivered; the underlying call was cancelled'

  await rejectTurn(ctx, {
    actor,
    round,
    request,
    reason: failure.timedOut ? 'provider_timeout' : 'provider_error',
    detail: [
      failure.message,
      cancellationNote,
      'reservation settled in full: billing status unknown',
      ...(stillRunning ? ['lease held open until the in-flight window closes'] : []),
    ],
    nextState: 'WAITING_HUMAN',
    costUsd: request.reserved_cost_usd,
  })
  return {
    kind: 'halted',
    stop_reason: failure.timedOut ? 'provider_timeout' : 'provider_error',
    message: failure.message,
    ...(stillRunning
      ? {
          in_flight_risk: {
            reason:
              `${providerFor(ctx, actor).name} declares cancellation.supported=false; the ` +
              `${failure.timedOut ? 'timed-out' : 'failed'} call may still be running for up to ` +
              `${provider.cancellation.server_max_timeout_ms}ms`,
          },
        }
      : {}),
  }
}

/**
 * Actual usage above the reservation means the price model is wrong, not that the
 * cap is soft. It stops the run for a human rather than quietly absorbing it.
 */
export async function checkCostReconciliation(
  ctx: RunnerContext,
  actor: Actor,
  round: number,
  request: TurnRequest,
  actualUsd: number
): Promise<TurnOutcome | null> {
  if (actualUsd <= request.reserved_cost_usd) return null

  await rejectTurn(ctx, {
    actor,
    round,
    request,
    reason: 'cost_overrun',
    detail: [
      `actual $${actualUsd.toFixed(6)} exceeded the reserved $${request.reserved_cost_usd.toFixed(6)}`,
      `pricing_version ${request.cost_estimate.pricing_version} for model ${request.cost_estimate.model}`,
      'the price model is wrong; treat as a pricing/configuration violation',
    ],
    nextState: 'WAITING_HUMAN',
    costUsd: actualUsd,
  })
  return {
    kind: 'halted',
    stop_reason: 'cost_overrun',
    message: `actual cost $${actualUsd.toFixed(6)} exceeded its reservation`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The two turns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The authoritative record of one turn: the workspace delta plus the harness's
 * tool log. Shared by both actors so "what actually happened" is assembled one
 * way — the reviewer used to get no record at all, which is how a write during a
 * read-only turn had nowhere to show up.
 */
export function factsFrom(delta: TurnDelta, telemetry: ProviderTelemetry): AuthoritativeTurnFacts {
  return {
    files_changed: [...delta.files_changed],
    cumulative_files_changed: [...delta.cumulative_files_changed],
    tools_used: [...telemetry.tools_used],
    commit: delta.commit,
    pull_request: delta.pull_request,
    pull_request_opened_this_turn: delta.pull_request_opened_this_turn,
    pushed_this_turn: delta.pushed_this_turn,
    remote_head_delta: delta.remote_head_delta,
    remote_facts_available: delta.remote_facts_available,
    sources: { workspace: delta.source, telemetry: telemetry.source },
  }
}

