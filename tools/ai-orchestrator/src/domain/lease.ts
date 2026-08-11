/**
 * Lease bookkeeping, derived purely from the ledger.
 *
 * **This is not the exclusion mechanism, and earlier versions of this file were
 * wrong to imply it was.** Appending an Issue comment is not a compare-and-set:
 * two runners reading an idle ledger at the same instant both conclude
 * `acquired: true`, both append, and both proceed to a paid call. Detecting that
 * afterwards records the duplicate spend; it does not prevent it.
 *
 * Exclusion comes from `policy/exclusivity.ts` — a verified GitHub Actions
 * concurrency context, which GitHub enforces before either process starts. What
 * lives here is the *audit trail* of who held the run and when, plus stale
 * detection so a crashed holder does not park the run forever.
 *
 * Every acquisition carries a `lease_id` fencing token. A release only closes
 * the lease it names: a paused holder waking up after its lease lapsed cannot
 * free the lease that replaced it.
 */

import type { LedgerEvent } from './schema'

export interface HeldLease {
  holder: string
  lease_id: string
  expires_at: string
  /** True when the lease is past its TTL and may be taken over. */
  stale: boolean
}

export function leaseKeyFor(repository: { owner: string; repo: string }, issueNumber: number): string {
  return `${repository.owner}/${repository.repo}#${issueNumber}`
}

/**
 * The most recent unreleased lease for `lockKey`, or null when free.
 *
 * A `lease_released` is honoured only when its lock key, holder AND lease id all
 * match the live lease. Matching on lock key alone let a late release from a
 * superseded holder hand the lock to a third runner while the current holder was
 * still working.
 */
export function currentLease(
  events: readonly LedgerEvent[],
  lockKey: string,
  now: Date
): HeldLease | null {
  let held: HeldLease | null = null

  for (const event of events) {
    if (event.event === 'lease_acquired' && event.lock_key === lockKey) {
      held = {
        holder: event.holder,
        lease_id: event.lease_id,
        expires_at: event.expires_at,
        stale: false,
      }
      continue
    }

    if (event.event === 'lease_released' && event.lock_key === lockKey) {
      const closesTheLiveLease =
        held !== null && held.holder === event.holder && held.lease_id === event.lease_id
      if (closesTheLiveLease) held = null
      // Otherwise: a late release from a holder that no longer owns anything.
      // Ignored on purpose — see the note at the top of this file.
      continue
    }

    // A holder that stopped waiting on a provider it cannot cancel keeps the lease
    // instead of freeing it, and pushes the expiry out to cover the window that
    // call could still be running in. Same fencing rule as a release: only the
    // live lease can be extended, and only by the holder that owns it.
    if (event.event === 'lease_retained' && event.lock_key === lockKey) {
      const extendsTheLiveLease =
        held !== null && held.holder === event.holder && held.lease_id === event.lease_id
      if (!extendsTheLiveLease || held === null) continue
      // Never shorten: a retention is a floor on the expiry, not a replacement.
      if (Date.parse(event.retained_until) > Date.parse(held.expires_at)) {
        held = { ...held, expires_at: event.retained_until }
      }
    }
  }

  if (held) {
    held = { ...held, stale: Date.parse(held.expires_at) <= now.getTime() }
  }

  return held
}

export type LeaseAcquisition =
  | { acquired: true; lease_id: string; took_over_from: string | null; expires_at: string }
  | { acquired: false; held_by: string; lease_id: string; expires_at: string }

export function evaluateLeaseAcquisition(args: {
  events: readonly LedgerEvent[]
  lockKey: string
  holder: string
  now: Date
  ttlMs: number
  /** Fencing token for this attempt. Must be unique per acquisition. */
  leaseId: string
}): LeaseAcquisition {
  const { events, lockKey, holder, now, ttlMs, leaseId } = args
  const existing = currentLease(events, lockKey, now)
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString()

  if (!existing) {
    return { acquired: true, lease_id: leaseId, took_over_from: null, expires_at: expiresAt }
  }

  // Re-entrant: the same holder re-running its own workflow extends its lease,
  // under a fresh fencing token so the previous one can no longer release it.
  if (existing.holder === holder) {
    return { acquired: true, lease_id: leaseId, took_over_from: null, expires_at: expiresAt }
  }

  if (existing.stale) {
    return {
      acquired: true,
      lease_id: leaseId,
      took_over_from: existing.holder,
      expires_at: expiresAt,
    }
  }

  return {
    acquired: false,
    held_by: existing.holder,
    lease_id: existing.lease_id,
    expires_at: existing.expires_at,
  }
}
