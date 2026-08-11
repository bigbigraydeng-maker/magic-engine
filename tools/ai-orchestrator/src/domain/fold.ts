/**
 * Derives the current run from the ledger.
 *
 * The ledger is the record; this fold is the only way run state is computed.
 * Keeping no second copy is what makes a re-dispatched workflow safe: it reads
 * the same events and lands on the same state instead of replaying work.
 *
 * Money is not folded here — `computeBudgetLedger` owns that, because spend has
 * to account for live and orphaned reservations as well as settled turns, and
 * that needs the current time.
 */

import { committedSpend } from './budget'
import type { BudgetLedger } from './budget'
import type { LedgerEvent, OrchestrationRun } from './schema'

export function foldRun(
  initial: OrchestrationRun,
  events: readonly LedgerEvent[],
  lastCommentId: number | null,
  budget: BudgetLedger
): OrchestrationRun {
  let run: OrchestrationRun = {
    ...initial,
    last_processed_comment_id: lastCommentId,
    cumulative_cost_usd: committedSpend(budget),
  }

  for (const event of events) {
    if (event.run_id !== initial.run_id) continue

    switch (event.event) {
      // turn_started deliberately does NOT advance the round. A claim is an
      // attempt, not a result: if the runner holding it dies, the retry has to
      // land on the same round so it computes the same idempotency key and can
      // see the claim it is retrying. Advancing here would skip the round, mint a
      // fresh key, and make the claim protect nothing.
      case 'turn_completed':
        run = { ...run, state: event.next_state, current_round: Math.max(run.current_round, event.round) }
        break
      case 'turn_rejected':
        run = {
          ...run,
          state: event.next_state,
          current_round: Math.max(run.current_round, event.round),
          invalid_output_count:
            run.invalid_output_count + (event.reason === 'invalid_output' ? 1 : 0),
        }
        break
      case 'state_changed':
        run = { ...run, state: event.to }
        break
      case 'run_finished':
        run = { ...run, state: event.final_state, stop_reason: event.stop_reason }
        break
      default:
        break
    }
  }

  return run
}
