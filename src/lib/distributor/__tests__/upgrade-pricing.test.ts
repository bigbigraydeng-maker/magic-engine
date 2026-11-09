import { describe, expect, it } from 'vitest'
import {
  AI_STEWARD_RULES_V1 as RULES,
  evaluateUpgrade,
  indexDistributors,
  priceOrder,
  PricingError,
  type Distributor,
  type DistributorLevel,
  type Sale,
} from '../index'

const T0 = '2026-01-01T00:00:00.000Z'
const AS_OF = '2026-06-01T00:00:00.000Z'

function dist(id: string, parentId: string | null, level: DistributorLevel): Distributor {
  return { id, parentId, levelHistory: [{ level, effectiveFrom: T0 }] }
}

let seq = 0
function sale(sellerId: string, amountCents: number, extra: Partial<Sale> = {}): Sale {
  seq += 1
  return { id: `u${seq}`, sellerId, kind: 'plan', amountCents, paidAt: '2026-05-01T00:00:00.000Z', isSelfPurchase: false, ...extra }
}

function decide(distributors: Distributor[], id: string, allSales: Sale[], months: number[] = []) {
  return evaluateUpgrade({
    distributorId: id,
    index: indexDistributors(distributors),
    allSales,
    recentMonthlyTeamSalesCents: months,
    asOf: AS_OF,
    rules: RULES,
  })
}

describe('standard → tier1', () => {
  const me = [dist('m', null, 'standard')]

  it('upgrades on one self-purchase of 20 months of the 799 plan', () => {
    expect(decide(me, 'm', [sale('m', 1_598_000, { isSelfPurchase: true })]).next).toBe('tier1')
  })

  it('does not count a self-purchase still inside the refund window', () => {
    const fresh = sale('m', 1_598_000, { isSelfPurchase: true, paidAt: '2026-05-25T00:00:00.000Z' })
    expect(decide(me, 'm', [fresh]).next).toBeNull()
  })

  it('does not count a self-purchase that was partly refunded below the threshold', () => {
    const big = sale('m', 1_598_000, { isSelfPurchase: true })
    const refund = sale('m', -79_900, { kind: 'refund', refundOfSaleId: big.id })
    expect(decide(me, 'm', [big, refund]).next).toBeNull()
  })

  it('upgrades on cumulative direct sales worth 30 months of the 799 plan', () => {
    const sales = Array.from({ length: 30 }, () => sale('m', 79_900))
    expect(decide(me, 'm', sales).next).toBe('tier1')
    expect(decide(me, 'm', sales.slice(1)).next).toBeNull()
  })

  it('does not mix self-purchases into the cumulative direct-sales path', () => {
    const sales = [sale('m', 1_500_000, { isSelfPurchase: true }), sale('m', 900_000)]
    expect(decide(me, 'm', sales).next).toBeNull()
  })
})

describe('tier1 → premier', () => {
  const team = [dist('p', null, 'tier1'), dist('k1', 'p', 'tier1'), dist('k2', 'p', 'premier'), dist('k3', 'p', 'standard')]

  it('needs 3 consecutive months at 150k and 2 direct tier1+', () => {
    expect(decide(team, 'p', [], [15_000_000, 15_000_000, 20_000_000]).next).toBe('premier')
  })

  it('fails when one recent month is short or history is too short', () => {
    expect(decide(team, 'p', [], [15_000_000, 14_999_999, 20_000_000]).next).toBeNull()
    expect(decide(team, 'p', [], [20_000_000, 20_000_000]).next).toBeNull()
  })

  it('fails with only one direct tier1', () => {
    const thin = [dist('p', null, 'tier1'), dist('k1', 'p', 'tier1'), dist('k3', 'p', 'standard')]
    expect(decide(thin, 'p', [], [20_000_000, 20_000_000, 20_000_000]).next).toBeNull()
  })

  it('never moves a premier', () => {
    expect(decide([dist('z', null, 'premier')], 'z', []).next).toBeNull()
  })
})

describe('priceOrder', () => {
  it('prices plan months plus one-time extra avatars', () => {
    expect(priceOrder({ planCode: 'videos-6', months: 1, extraAvatars: 0 }, RULES)).toBe(39_900)
    expect(priceOrder({ planCode: 'videos-16', months: 1, extraAvatars: 2 }, RULES)).toBe(99_900)
    expect(priceOrder({ planCode: 'videos-60', months: 12, extraAvatars: 0 }, RULES)).toBe(2_638_800)
  })

  it('rejects unknown plans and bad quantities', () => {
    expect(() => priceOrder({ planCode: 'nope', months: 1, extraAvatars: 0 }, RULES)).toThrow(PricingError)
    expect(() => priceOrder({ planCode: 'videos-6', months: 0, extraAvatars: 0 }, RULES)).toThrow(PricingError)
    expect(() => priceOrder({ planCode: 'videos-6', months: 1, extraAvatars: -1 }, RULES)).toThrow(PricingError)
  })
})
