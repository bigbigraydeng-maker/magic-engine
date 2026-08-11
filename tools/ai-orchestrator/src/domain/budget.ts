/**
 * Budget accounting with reservations.
 *
 * The first version compared *already-settled* spend against the cap, which meant
 * the cap could be crossed by the very next call: a run at $1.95 of a $2.00 cap
 * would happily start a $0.40 turn. A cap that is only checked after the money is
 * gone is not a cap.
 *
 * So money is committed **before** the call, not after:
 *
 *   quote worst case -> reserve that quote -> call -> reconcile against actual
 *
 * and the run may only start a turn when `remaining` covers the quote. The quote
 * comes from the provider's own price table, not from a fixed constant — a flat
 * figure is not an upper bound for a model whose price the runner does not know.
 *
 * Three kinds of commitment, all counted against the cap:
 *
 *   settled     a turn finished; actual usage is known
 *   outstanding a claim is live; the call may be in flight right now
 *   orphaned    a claim expired with no completion — we do not know whether the
 *               provider billed us, so we assume it did
 *
 * Orphaned reservations are deliberately never released. Releasing them would let
 * a crash-loop spend without limit, which is the failure this exists to prevent.
 */

import type { LedgerEvent } from './schema'

export interface BudgetLedger {
  settled_cost_usd: number
  outstanding_reserved_usd: number
  orphaned_reserved_usd: number
  /** Claims that are live right now, keyed by idempotency key. */
  live_claims: readonly LiveClaim[]
}

export interface LiveClaim {
  idempotency_key: string
  holder: string
  reserved_cost_usd: number
  claim_expires_at: string
}

interface OpenClaim extends LiveClaim {
  closed: boolean
}

export function computeBudgetLedger(
  events: readonly LedgerEvent[],
  runId: string,
  now: Date
): BudgetLedger {
  const claims = new Map<string, OpenClaim>()
  let settled = 0

  for (const event of events) {
    if (event.run_id !== runId) continue

    if (event.event === 'turn_started') {
      claims.set(event.idempotency_key, {
        idempotency_key: event.idempotency_key,
        holder: event.holder,
        reserved_cost_usd: event.reserved_cost_usd,
        claim_expires_at: event.claim_expires_at,
        closed: false,
      })
      continue
    }

    if (event.event === 'turn_completed' || event.event === 'turn_rejected') {
      const claim = claims.get(event.idempotency_key)
      if (claim) claim.closed = true
      settled += event.cost_usd
      continue
    }

    // Money spent on a call whose result we threw away. It is still money.
    if (event.event === 'duplicate_spend_recorded') {
      settled += event.cost_usd
    }
  }

  let outstanding = 0
  let orphaned = 0
  const live: LiveClaim[] = []

  for (const claim of Array.from(claims.values())) {
    if (claim.closed) continue
    const expired = Date.parse(claim.claim_expires_at) <= now.getTime()
    if (expired) {
      orphaned += claim.reserved_cost_usd
    } else {
      outstanding += claim.reserved_cost_usd
      live.push(claim)
    }
  }

  return {
    settled_cost_usd: settled,
    outstanding_reserved_usd: outstanding,
    orphaned_reserved_usd: orphaned,
    live_claims: live,
  }
}

/** Everything the cap has to cover: spent, in flight, and presumed-spent. */
export function committedSpend(ledger: BudgetLedger): number {
  return (
    ledger.settled_cost_usd + ledger.outstanding_reserved_usd + ledger.orphaned_reserved_usd
  )
}

export function remainingBudget(capUsd: number, ledger: BudgetLedger): number {
  return Math.max(0, capUsd - committedSpend(ledger))
}

/**
 * A live claim held by someone else for this exact turn. Its existence is what
 * stops a second runner from starting a second paid call for the same work.
 */
export function foreignLiveClaim(
  ledger: BudgetLedger,
  idempotencyKey: string,
  holder: string
): LiveClaim | null {
  return (
    ledger.live_claims.find(
      (claim) => claim.idempotency_key === idempotencyKey && claim.holder !== holder
    ) ?? null
  )
}
