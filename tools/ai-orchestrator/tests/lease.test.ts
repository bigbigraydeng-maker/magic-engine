/**
 * Lease bookkeeping and fencing tokens.
 *
 * The bug these exist for: `currentLease` used to close the live lease on any
 * `lease_released` for the same lock key. So a holder that was paused past its
 * TTL, replaced by a takeover, and then woke up and wrote its release would free
 * *someone else's* lease — handing the lock to a third runner while the real
 * holder was still working, and paying for calls.
 *
 * A release now has to name the lease it is releasing.
 *
 * Note what this file does NOT claim: none of it is mutual exclusion. Appending
 * a comment is not a compare-and-set. Exclusion lives in `policy/exclusivity.ts`;
 * this is the audit trail and the stale-holder recovery.
 */

import { describe, expect, it } from 'vitest'

import { currentLease, evaluateLeaseAcquisition, leaseKeyFor } from '../src/domain/lease'
import type { LedgerEvent } from '../src/domain/schema'

const NOW = new Date('2026-08-07T00:00:00.000Z')
const LOCK = leaseKeyFor({ owner: 'bigbigraydeng-maker', repo: 'magic-engine' }, 860)
const TTL = 10 * 60 * 1000

function acquired(
  holder: string,
  leaseId: string,
  expiresAt: Date,
  tookOverFrom: string | null = null
): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: 'run-a',
    at: NOW.toISOString(),
    event: 'lease_acquired',
    lock_key: LOCK,
    holder,
    lease_id: leaseId,
    expires_at: expiresAt.toISOString(),
    took_over_from: tookOverFrom,
  }
}

function released(holder: string, leaseId: string): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: 'run-a',
    at: NOW.toISOString(),
    event: 'lease_released',
    lock_key: LOCK,
    holder,
    lease_id: leaseId,
  }
}

const live = new Date(NOW.getTime() + TTL)
const lapsed = new Date(NOW.getTime() - 1)

describe('a holder can release its own lease', () => {
  it('frees the lock when holder and lease id both match', () => {
    const events = [acquired('A', 'lease-1', live), released('A', 'lease-1')]
    expect(currentLease(events, LOCK, NOW)).toBeNull()
  })

  it('keeps the lease when the release names a different lease id', () => {
    const events = [acquired('A', 'lease-2', live), released('A', 'lease-1')]
    expect(currentLease(events, LOCK, NOW)).toMatchObject({ holder: 'A', lease_id: 'lease-2' })
  })

  it('keeps the lease when the release comes from a different holder', () => {
    const events = [acquired('A', 'lease-1', live), released('B', 'lease-1')]
    expect(currentLease(events, LOCK, NOW)).toMatchObject({ holder: 'A' })
  })
})

describe('a late release from a superseded holder cannot free the new lease', () => {
  // The full sequence from the review: A takes the lock, A lapses, B takes over,
  // A wakes up and releases. B must still hold it.
  const takeover: LedgerEvent[] = [
    acquired('A', 'lease-1', lapsed),
    acquired('B', 'lease-2', live, 'A'),
  ]

  it('1. A holds it, then releases normally', () => {
    const events = [acquired('A', 'lease-1', live), released('A', 'lease-1')]
    expect(currentLease(events, LOCK, NOW)).toBeNull()
  })

  it('2. A lapses and B takes over, recording who it took it from', () => {
    const result = evaluateLeaseAcquisition({
      events: [acquired('A', 'lease-1', lapsed)],
      lockKey: LOCK,
      holder: 'B',
      now: NOW,
      ttlMs: TTL,
      leaseId: 'lease-2',
    })
    expect(result).toMatchObject({ acquired: true, took_over_from: 'A', lease_id: 'lease-2' })
  })

  it("3. A's late release does not touch B's lease", () => {
    const events = [...takeover, released('A', 'lease-1')]
    expect(currentLease(events, LOCK, NOW)).toMatchObject({ holder: 'B', lease_id: 'lease-2' })
  })

  it('4. B still blocks a third runner afterwards', () => {
    const events = [...takeover, released('A', 'lease-1')]
    const result = evaluateLeaseAcquisition({
      events,
      lockKey: LOCK,
      holder: 'C',
      now: NOW,
      ttlMs: TTL,
      leaseId: 'lease-3',
    })
    expect(result).toMatchObject({ acquired: false, held_by: 'B' })
  })

  it("5. only B's own release, carrying lease-2, frees the lock", () => {
    const events = [...takeover, released('A', 'lease-1'), released('B', 'lease-2')]
    expect(currentLease(events, LOCK, NOW)).toBeNull()
    expect(
      evaluateLeaseAcquisition({
        events,
        lockKey: LOCK,
        holder: 'C',
        now: NOW,
        ttlMs: TTL,
        leaseId: 'lease-3',
      }).acquired
    ).toBe(true)
  })

  it('ignores a stale release even when it arrives before the takeover', () => {
    const events = [acquired('A', 'lease-1', lapsed), released('A', 'lease-1'), acquired('B', 'lease-2', live)]
    expect(currentLease(events, LOCK, NOW)).toMatchObject({ holder: 'B' })
  })
})

describe('contention and staleness', () => {
  it('refuses a second holder while the lease is live', () => {
    const result = evaluateLeaseAcquisition({
      events: [acquired('A', 'lease-1', live)],
      lockKey: LOCK,
      holder: 'B',
      now: new Date(NOW.getTime() + 1000),
      ttlMs: TTL,
      leaseId: 'lease-2',
    })
    expect(result).toMatchObject({ acquired: false, held_by: 'A', lease_id: 'lease-1' })
  })

  it('lets a different Issue proceed in parallel', () => {
    const otherLock = leaseKeyFor({ owner: 'bigbigraydeng-maker', repo: 'magic-engine' }, 859)
    expect(
      evaluateLeaseAcquisition({
        events: [acquired('A', 'lease-1', live)],
        lockKey: otherLock,
        holder: 'B',
        now: NOW,
        ttlMs: TTL,
        leaseId: 'lease-2',
      }).acquired
    ).toBe(true)
  })

  it('marks a lease stale exactly at its expiry, not after', () => {
    const events = [acquired('A', 'lease-1', live)]
    expect(currentLease(events, LOCK, new Date(live.getTime() - 1))?.stale).toBe(false)
    expect(currentLease(events, LOCK, live)?.stale).toBe(true)
  })

  it('gives the same holder a fresh fencing token when it re-enters', () => {
    // The old token must stop working, otherwise a straggler from the previous
    // attempt could release the new lease.
    const result = evaluateLeaseAcquisition({
      events: [acquired('A', 'lease-1', live)],
      lockKey: LOCK,
      holder: 'A',
      now: NOW,
      ttlMs: TTL,
      leaseId: 'lease-2',
    })
    expect(result).toMatchObject({ acquired: true, lease_id: 'lease-2' })

    const events = [acquired('A', 'lease-1', live), acquired('A', 'lease-2', live), released('A', 'lease-1')]
    expect(currentLease(events, LOCK, NOW)).toMatchObject({ lease_id: 'lease-2' })
  })
})
