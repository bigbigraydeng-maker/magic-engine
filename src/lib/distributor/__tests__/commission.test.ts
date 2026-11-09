import { describe, expect, it } from 'vitest'
import {
  AI_STEWARD_RULES_V1 as RULES,
  applyRate,
  computeStatement,
  DistributorRefundError,
  DistributorTreeError,
  indexDistributors,
  teamLines,
  teamRateFor,
  type Distributor,
  type DistributorLevel,
  type Sale,
  type StatementInput,
} from '../index'

const T0 = '2026-01-01T00:00:00+13:00'
const MAR = '2026-03-10T00:00:00+13:00'
const APR = '2026-04-10T00:00:00+12:00'
const MAR_END = '2026-04-01T00:00:00+13:00'
const APR_END = '2026-05-01T00:00:00+12:00'

function dist(id: string, parentId: string | null, level: DistributorLevel, extra: Partial<Distributor> = {}): Distributor {
  return { id, parentId, levelHistory: [{ level, effectiveFrom: T0 }], ...extra }
}

let seq = 0
function sale(sellerId: string, amountCents: number, extra: Partial<Sale> = {}): Sale {
  seq += 1
  return { id: `s${seq}`, sellerId, kind: 'plan', amountCents, currency: 'NZD', paidAt: MAR, isSelfPurchase: false, ...extra }
}

function refundOf(original: Sale, amountCents: number, paidAt = APR): Sale {
  return sale(original.sellerId, amountCents, { kind: 'refund', refundOfSaleId: original.id, paidAt })
}

function run(partial: Partial<StatementInput> & Pick<StatementInput, 'distributors' | 'periodSales'>) {
  return computeStatement({
    allSales: partial.periodSales,
    periodEnd: MAR_END,
    rules: RULES,
    teamRatesByMonth: new Map(),
    ...partial,
  })
}

function sum(stmt: ReturnType<typeof computeStatement>, id: string, kind: string): number {
  return stmt.lines.filter((l) => l.distributorId === id && l.kind === kind).reduce((s, l) => s + l.amountCents, 0)
}

describe('applyRate / teamRateFor', () => {
  it('floors positive amounts and mirrors negatives exactly', () => {
    expect(applyRate(79_900, 3500)).toBe(27_965)
    expect(applyRate(-99_999, 3333)).toBe(-33_329)
  })

  it('uses the ladder boundaries agreed with the PM', () => {
    expect(teamRateFor(4_999_999, RULES)).toBe(0)
    expect(teamRateFor(5_000_000, RULES)).toBe(600)
    expect(teamRateFor(15_000_000, RULES)).toBe(800)
    expect(teamRateFor(100_000_000, RULES)).toBe(1600)
    expect(teamRateFor(500_000_000, RULES)).toBe(1600)
  })
})

describe('retail and peer commission', () => {
  it('pays retail by the seller level at sale time', () => {
    const stmt = run({
      distributors: [dist('n', null, 'standard'), dist('t', null, 'tier1'), dist('p', null, 'premier')],
      periodSales: [sale('n', 79_900), sale('t', 79_900), sale('p', 79_900)],
    })
    expect(sum(stmt, 'n', 'retail')).toBe(15_980)
    expect(sum(stmt, 't', 'retail')).toBe(23_970)
    expect(sum(stmt, 'p', 'retail')).toBe(27_965)
  })

  it('pays 5% peer to the nearest same-level upline only, skipping other levels', () => {
    const distributors = [dist('a', null, 'tier1'), dist('b', 'a', 'premier'), dist('c', 'b', 'tier1'), dist('d', 'c', 'tier1')]
    const stmt = run({ distributors, periodSales: [sale('d', 79_900), sale('c', 79_900)] })
    expect(sum(stmt, 'c', 'peer')).toBe(3_995) // from d
    expect(sum(stmt, 'a', 'peer')).toBe(3_995) // from c, skipping premier b
    expect(sum(stmt, 'b', 'peer')).toBe(0)
  })

  it('records earnings of a suspended distributor as not payable', () => {
    const stmt = run({ distributors: [dist('s', null, 'standard', { suspended: true })], periodSales: [sale('s', 79_900)] })
    expect(stmt.lines.every((l) => !l.payable)).toBe(true)
    expect(stmt.balances.get('s')?.payoutCents).toBe(0)
  })

  it('rejects a sale in a foreign currency', () => {
    expect(() => run({ distributors: [dist('x', null, 'standard')], periodSales: [sale('x', 100, { currency: 'AUD' })] }))
      .toThrow(DistributorTreeError)
  })
})

describe('refunds', () => {
  const marRates = (rates: Record<string, number>) => new Map([['2026-03', new Map(Object.entries(rates))]])

  it('claws back retail at the original level, even after an upgrade', () => {
    const seller = dist('x', null, 'standard', {
      levelHistory: [{ level: 'standard', effectiveFrom: T0 }, { level: 'premier', effectiveFrom: '2026-03-20T00:00:00+13:00' }],
    })
    const original = sale('x', 79_900)
    const refund = refundOf(original, -79_900)
    const stmt = run({ distributors: [seller], periodSales: [refund], allSales: [original, refund], periodEnd: APR_END, teamRatesByMonth: marRates({}) })
    expect(sum(stmt, 'x', 'retail')).toBe(-15_980)
  })

  it('claws back team commission paid in the original month', () => {
    const original = sale('A', 10_000_000)
    const march = run({ distributors: [dist('A', null, 'standard')], periodSales: [original] })
    expect(sum(march, 'A', 'team')).toBe(600_000)
    const refund = refundOf(original, -10_000_000)
    const april = run({
      distributors: [dist('A', null, 'standard')],
      periodSales: [refund],
      allSales: [original, refund],
      periodEnd: APR_END,
      teamRatesByMonth: new Map([['2026-03', march.teamRateBp]]),
    })
    expect(sum(april, 'A', 'team')).toBe(-600_000)
    expect(sum(april, 'A', 'retail')).toBe(-2_000_000)
  })

  it('does not let an old refund drag this month below the ladder', () => {
    const marchSale = sale('A', 2_000_000)
    const aprilSale = sale('A', 6_000_000, { paidAt: APR })
    const refund = refundOf(marchSale, -2_000_000)
    const stmt = run({
      distributors: [dist('A', null, 'standard')],
      periodSales: [aprilSale, refund],
      allSales: [marchSale, aprilSale, refund],
      periodEnd: APR_END,
      teamRatesByMonth: marRates({ A: 600 }),
    })
    expect(sum(stmt, 'A', 'team')).toBe(360_000 - 120_000)
  })

  it('charges an upline refund to the upline and carries the debt, while the child is paid in full', () => {
    const febSale = sale('p', 10_000_000, { paidAt: '2026-02-10T00:00:00+13:00' })
    const refund = refundOf(febSale, -10_000_000, MAR)
    const childSale = sale('c', 16_000_000)
    const stmt = run({
      distributors: [dist('p', null, 'tier1'), dist('c', 'p', 'standard')],
      periodSales: [refund, childSale],
      allSales: [febSale, refund, childSale],
      teamRatesByMonth: new Map([['2026-02', new Map([['p', 600]])]]),
    })
    // c: retail 20% × 160k + team 8% × 160k, untouched by p's refund.
    expect(stmt.balances.get('c')).toEqual({ openingCents: 0, periodCents: 3_200_000 + 1_280_000, payoutCents: 4_480_000, closingCents: 0 })
    // p: retail clawback 30% × 100k + Feb team clawback 6% × 100k; nothing to pay, debt carried.
    expect(stmt.balances.get('p')).toEqual({ openingCents: 0, periodCents: -3_600_000, payoutCents: 0, closingCents: -3_600_000 })
  })

  it('claws back exactly the full commission across many tiny partial refunds', () => {
    const original = sale('x', 79_900)
    const refunds = [-4, -4, -4, -4, -79_884].map((a, i) => refundOf(original, a, `2026-04-1${i}T00:00:00+12:00`))
    const stmt = run({
      distributors: [dist('x', null, 'standard')],
      periodSales: refunds,
      allSales: [original, ...refunds],
      periodEnd: APR_END,
      teamRatesByMonth: marRates({}),
    })
    expect(sum(stmt, 'x', 'retail')).toBe(-15_980)
  })

  it('nets a same-month sale and its refund to zero team commission', () => {
    const original = sale('A', 10_000_000)
    const refund = refundOf(original, -10_000_000, '2026-03-20T00:00:00+13:00')
    const stmt = run({ distributors: [dist('A', null, 'standard')], periodSales: [original, refund] })
    expect(sum(stmt, 'A', 'team')).toBe(0)
    expect(sum(stmt, 'A', 'retail')).toBe(0)
  })

  it('fails closed on bad refunds', () => {
    const original = sale('x', 79_900)
    const distributors = [dist('x', null, 'standard'), dist('y', null, 'standard')]
    const wrongSeller = sale('y', -100, { kind: 'refund', refundOfSaleId: original.id, paidAt: APR })
    const tooBig = refundOf(original, -79_901)
    const ofRefund = sale('x', -1, { kind: 'refund', refundOfSaleId: tooBig.id, paidAt: APR })
    const missing = sale('x', -1, { kind: 'refund', refundOfSaleId: 'nope', paidAt: APR })
    for (const bad of [wrongSeller, tooBig, ofRefund, missing]) {
      expect(() => run({ distributors, periodSales: [bad], allSales: [original, tooBig, bad], periodEnd: APR_END, teamRatesByMonth: marRates({}) }))
        .toThrow(DistributorRefundError)
    }
  })

  it('refuses to claw back team commission without the original month rates', () => {
    const original = sale('x', 79_900)
    const refund = refundOf(original, -79_900)
    expect(() => run({ distributors: [dist('x', null, 'standard')], periodSales: [refund], allSales: [original, refund], periodEnd: APR_END }))
      .toThrow(DistributorTreeError)
  })
})

describe('team differential commission', () => {
  it('reproduces the worked example in the spec (A → B → C)', () => {
    const stmt = run({
      distributors: [dist('A', null, 'premier'), dist('B', 'A', 'tier1'), dist('C', 'B', 'standard')],
      periodSales: [sale('C', 6_000_000), sale('B', 10_000_000), sale('A', 2_000_000)],
    })
    expect(sum(stmt, 'C', 'team')).toBe(360_000)
    expect(sum(stmt, 'B', 'team')).toBe(920_000)
    expect(sum(stmt, 'A', 'team')).toBe(160_000)
  })

  it('never pays more than the top rate on the whole tree (randomised trees)', () => {
    let state = 42
    const rand = (n: number): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
      return state % n
    }
    for (let trial = 0; trial < 50; trial += 1) {
      const distributors: Distributor[] = [dist('r', null, 'standard')]
      for (let i = 1; i < 30; i += 1) distributors.push(dist(`d${i}`, distributors[rand(i)].id, 'standard'))
      const sales = distributors.map((d) => sale(d.id, 1 + rand(8_000_000)))
      const result = teamLines(sales, indexDistributors(distributors), RULES, new Set())
      expect(result.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(result.grossCents.get('r'))
      for (const l of result.lines) expect(l.amountCents).toBeGreaterThan(0)
    }
  })

  it('withholds team commission of an upline with no live personal sales in 90 days', () => {
    const own = sale('A', 100_000, { paidAt: '2026-02-01T00:00:00+13:00' })
    const ownRefund = refundOf(own, -100_000, '2026-02-05T00:00:00+13:00')
    const periodSales = [sale('B', 10_000_000), sale('C', 10_000_000)]
    const stmt = run({
      distributors: [dist('A', null, 'tier1'), dist('B', 'A', 'standard'), dist('C', 'A', 'standard')],
      periodSales,
      allSales: [own, ownRefund, ...periodSales],
    })
    const aTeam = stmt.lines.find((l) => l.distributorId === 'A' && l.kind === 'team')
    expect(aTeam?.amountCents).toBe(400_000) // 8% × 200k − 2 × 6% × 100k
    expect(aTeam?.payable).toBe(false) // a fully refunded sale does not keep A active
  })
})

describe('balances and validation', () => {
  it('carries an opening debt forward and rejects a positive opening balance', () => {
    const stmt = run({ distributors: [dist('x', null, 'standard')], periodSales: [sale('x', 15_000)], openingBalances: new Map([['x', -5_000]]) })
    expect(stmt.balances.get('x')).toEqual({ openingCents: -5_000, periodCents: 3_000, payoutCents: 0, closingCents: -2_000 })
    expect(() => run({ distributors: [dist('x', null, 'standard')], periodSales: [], openingBalances: new Map([['x', 1]]) }))
      .toThrow(DistributorTreeError)
  })

  it('rejects unknown parents and cycles', () => {
    expect(() => indexDistributors([dist('a', 'ghost', 'standard')])).toThrow(DistributorTreeError)
    expect(() => indexDistributors([dist('a', 'b', 'standard'), dist('b', 'a', 'standard')])).toThrow(DistributorTreeError)
  })
})
