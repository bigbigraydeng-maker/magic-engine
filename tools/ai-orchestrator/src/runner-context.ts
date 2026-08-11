/**
 * Ledger writes and state transitions.
 *
 * Every mutation of the run goes through here, so cost accounting and the ledger
 * can never drift apart: `record` recomputes the budget from the events it just
 * wrote rather than incrementing a counter alongside them.
 */

import { committedSpend, computeBudgetLedger } from './domain/budget'
import { assertTransition } from './domain/state-machine'
import type { LedgerEvent, RunState, StopReason, WaitDescriptor } from './domain/schema'
import { LEDGER_SCHEMA_VERSION } from './domain/schema'
import type { RunnerContext, RunnerDeps } from './runner-types'

export function log(deps: RunnerDeps, line: string): void {
  deps.logger?.(line)
}

export async function record(ctx: RunnerContext, event: LedgerEvent): Promise<void> {
  await ctx.ledger.append(event)
  ctx.events.push(event)
  ctx.appended.push(event)
  ctx.budget = computeBudgetLedger(ctx.events, ctx.run.run_id, ctx.clock.now())
  // Keep the reported total in step with the ledger. Everything the cap has to
  // cover — settled, in flight and orphaned — is one number, computed one way.
  ctx.run = { ...ctx.run, cumulative_cost_usd: committedSpend(ctx.budget) }
}

export function baseEvent(ctx: RunnerContext): {
  schema_version: typeof LEDGER_SCHEMA_VERSION
  run_id: string
  at: string
} {
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    run_id: ctx.run.run_id,
    at: ctx.clock.now().toISOString(),
  }
}

/**
 * Records a state change that is NOT the result of an agent turn: starting the
 * run, a kill switch, a budget stop, a human resume. Turn-driven transitions ride
 * on the turn event itself (see `applyTurnState`).
 */
export async function transitionTo(
  ctx: RunnerContext,
  to: RunState,
  reason: string,
  options?: { wait?: WaitDescriptor; consumedWaitId?: string }
): Promise<void> {
  const from = ctx.run.state
  // A no-op transition is not an error. It happens when a second dispatch hits the
  // same guard that parked the run, and it must not throw.
  if (from === to) return
  assertTransition(from, to)
  ctx.run = { ...ctx.run, state: to, updated_at: ctx.clock.now().toISOString() }
  await record(ctx, {
    ...baseEvent(ctx),
    event: 'state_changed',
    from,
    to,
    reason,
    // Every arrival at WAITING_HUMAN opens a named wait; every departure names
    // the wait it consumed. See domain/state-machine.ts.
    wait: options?.wait ?? null,
    consumed_wait_id: options?.consumedWaitId ?? null,
  })
}

/**
 * Deterministic id for the next wait on this run, derived from the ledger.
 *
 * Counts every event kind that can open a wait. `turn_completed` is one of them:
 * a reviewer verdict of WAITING_HUMAN parks the run on a turn that completed
 * successfully. Missing it here would hand out an id that a previous wait already
 * used, and two blocks sharing an id means one approval clears both.
 */
export function nextWaitId(ctx: RunnerContext): string {
  const opened = ctx.events.filter(
    (event) =>
      (event.event === 'state_changed' && event.wait !== null) ||
      (event.event === 'turn_rejected' && event.wait !== null) ||
      (event.event === 'turn_completed' && event.wait !== null)
  ).length
  return `wait-${ctx.run.run_id}-${opened + 1}`
}

/** Validates and applies a turn-driven transition without emitting its own event. */
export function applyTurnState(ctx: RunnerContext, to: RunState): RunState {
  if (ctx.run.state !== to) assertTransition(ctx.run.state, to)
  ctx.run = { ...ctx.run, state: to, updated_at: ctx.clock.now().toISOString() }
  return to
}

export async function finish(ctx: RunnerContext, stopReason: StopReason | null): Promise<void> {
  ctx.run = { ...ctx.run, stop_reason: stopReason }
  await record(ctx, {
    ...baseEvent(ctx),
    event: 'run_finished',
    final_state: ctx.run.state,
    stop_reason: stopReason,
  })
}
