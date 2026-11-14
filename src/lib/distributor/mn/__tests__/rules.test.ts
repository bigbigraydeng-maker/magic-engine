import { describe, expect, it } from 'vitest'
import {
  applyGate,
  attributePurchase,
  classifySale,
  clawbackCents,
  evaluateIdentity,
  markPaid,
  markSettled,
  MnConfigError,
  productShareLink,
  PROPOSED_IDENTITY_POLICY,
  qualifyInstant,
  settleMonth,
  withReviewFixes,
  type IdentityFacts,
  type MnOrder,
  type MnPerson,
} from '../index'

const baseFacts = (over: Partial<IdentityFacts> = {}): IdentityFacts => ({
  joined: true,
  cumulativeValidMuCents: 0,
  joinedDirects: 0,
  directsWithQualifiedNonSelfSale: 0,
  personalMuCents: 0,
  directLineMuCents: [],
  priorQualifyingTeamMuCents: [],
  heldNode: false,
  heldNexus: false,
  invitedCore: false,
  ...over,
})

describe('identity proposal and review switches', () => {
  it('uses the unconfirmed proposal and does not require the review fixes', () => {
    expect(PROPOSED_IDENTITY_POLICY.confirmed).toBe(false)
    const node = evaluateIdentity(baseFacts({ cumulativeValidMuCents: 288_000, joinedDirects: 3 }), PROPOSED_IDENTITY_POLICY)
    expect(node.identity).toBe('Node')
    const jumped = evaluateIdentity(baseFacts({ personalMuCents: 1_080_000 }), PROPOSED_IDENTITY_POLICY)
    expect(jumped.identity).toBe('Nexus')
    const stuck = evaluateIdentity(baseFacts({ cumulativeValidMuCents: 287_999, joinedDirects: 3 }), PROPOSED_IDENTITY_POLICY)
    expect(stuck.identity).toBe('Link')
  })

  it('turns the review fixes on without changing the default', () => {
    const review = withReviewFixes()
    const emptyDirects = evaluateIdentity(baseFacts({
      cumulativeValidMuCents: 288_000, joinedDirects: 3, personalMuCents: 1_080_000,
    }), review)
    expect(emptyDirects.identity).toBe('Link')
    const qualified = evaluateIdentity(baseFacts({
      cumulativeValidMuCents: 287_640,
      directsWithQualifiedNonSelfSale: 3,
      personalMuCents: 540_000,
      directLineMuCents: [540_000],
    }), review)
    expect(qualified.identity).toBe('Nexus')
    const oneLine = evaluateIdentity(baseFacts({
      cumulativeValidMuCents: 287_640,
      directsWithQualifiedNonSelfSale: 3,
      personalMuCents: 0,
      directLineMuCents: [1_080_000],
    }), review)
    expect(oneLine.nexus).toBe(false)
    expect(review.peerStartsNextMonth).toBe(true)
    expect(PROPOSED_IDENTITY_POLICY.peerStartsNextMonth).toBe(false)
  })

  it('keeps Core invite-only and drops it when Nexus does not hold', () => {
    const invited = evaluateIdentity(baseFacts({ invitedCore: true, heldNexus: true, personalMuCents: 0 }), PROPOSED_IDENTITY_POLICY)
    expect(invited.identity).toBe('Core')
    const review = withReviewFixes()
    const lapsed = evaluateIdentity(baseFacts({
      invitedCore: true, heldNexus: true, heldNode: true, personalMuCents: 0, priorQualifyingTeamMuCents: [],
    }), review)
    expect(lapsed.core).toBe(false)
  })
})

describe('60% gate order', () => {
  it('pays peer from the remainder, then cuts peer and only the 18% slice', () => {
    const inside = applyGate({
      poolMicros: 1_000_000n, reservedMicros: 900_000n, peerMicros: 200_000n, adjustmentMicros: 0n, marginal18Micros: 100_000n,
    })
    expect(inside.peerMicros).toBe(100_000n)
    expect(inside.teamCutMicros).toBe(0n)
    expect(inside.shortfallMicros).toBe(0n)

    const over = applyGate({
      poolMicros: 1_000_000n, reservedMicros: 1_100_000n, peerMicros: 50_000n, adjustmentMicros: 0n, marginal18Micros: 80_000n,
    })
    expect(over.peerMicros).toBe(0n)
    expect(over.teamCutMicros).toBe(80_000n)
    expect(over.shortfallMicros).toBe(20_000n)
  })
})

describe('ledger, attribution, and open rules', () => {
  it('waits 45 days, then settles only valid MU', () => {
    const paidAt = '2026-01-01T00:00:00+13:00'
    const early = classifySale({
      paidAt, now: '2026-02-01T00:00:00+13:00', refunded: false, observationDays: 45, timeZone: 'Pacific/Auckland',
    })
    expect(early.status).toBe('pending')
    const qualifiedAt = qualifyInstant(paidAt, 45)
    const ready = classifySale({
      paidAt, now: qualifiedAt, refunded: false, observationDays: 45, timeZone: 'Pacific/Auckland',
    })
    expect(ready).toMatchObject({ status: 'valid', salesMonth: '2026-02' })
    expect(classifySale({
      paidAt, now: qualifiedAt, refunded: true, observationDays: 45, timeZone: 'Pacific/Auckland',
    }).status).toBe('clawed_back')
    expect(markSettled('valid')).toBe('settled')
    expect(markPaid('settled')).toBe('paid')
    expect(() => markPaid('valid')).toThrow(MnConfigError)
    expect(clawbackCents(12_368, 14_382, 28_764)).toBe(-6_184)
  })

  it('attributes by lock or code and builds a product link from the existing code', () => {
    const kept = attributePurchase({
      now: '2026-11-14T00:00:00+13:00',
      codeOwnerId: 'other',
      existing: { sellerId: 'first', lockedAt: '2026-01-01T00:00:00+13:00' },
      policy: { lockDays: null },
    })
    expect(kept).toMatchObject({ sellerId: 'first', reason: 'existing-lock' })
    const fresh = attributePurchase({
      now: '2026-11-14T00:00:00+13:00', codeOwnerId: 'owner', existing: null, policy: { lockDays: null },
    })
    expect(fresh.reason).toBe('new-code')
    expect(attributePurchase({
      now: '2026-11-14T00:00:00+13:00', codeOwnerId: null, existing: null, policy: { lockDays: null },
    }).sellerId).toBeNull()
    expect(productShareLink('https://app.magicengine.com.au', 'magic-lab', 'abcd2345').url)
      .toBe('https://app.magicengine.com.au/mn/p/magic-lab?ref=ABCD2345')
  })

  it('refuses an annual order while recognition is still undecided', () => {
    const people: MnPerson[] = [{ id: 'a', parentId: null, identity: 'Link' }]
    const orders: MnOrder[] = [{ id: 'year', sellerId: 'a', productId: 'magic-lab', muCents: 287_640, annual: true }]
    expect(() => settleMonth({ month: '2026-11', people, orders, policy: PROPOSED_IDENTITY_POLICY })).toThrow(/annual recognition/)
  })

  it('counts only the configured number of self-purchases toward the meter', () => {
    const people: MnPerson[] = [{ id: 'a', parentId: null, identity: 'Link' }]
    const orders: MnOrder[] = [1, 2].map((index) => ({
      id: `self-${index}`, sellerId: 'a', productId: 'magic-lab', muCents: 28_764, selfPurchase: true,
    }))
    const capped = settleMonth({
      month: '2026-11', people, orders, policy: { ...PROPOSED_IDENTITY_POLICY, selfPurchaseCapUnitsPerMonth: 1 },
    })
    expect(capped.personalMuCents.get('a')).toBe(57_528)
    expect(capped.meterMuCents.get('a')).toBe(28_764)
    expect(capped.lines.filter((line) => line.kind === 'retail')).toHaveLength(2)
  })
})
