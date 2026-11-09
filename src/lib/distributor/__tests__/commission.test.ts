import { describe, expect, it } from 'vitest'
import {
  AI_STEWARD_RULES_V1 as RULES,
  applyRate,
  computeStatement,
  DistributorTreeError,
  indexDistributors,
  teamLines,
  teamRateFor,
  type Distributor,
  type DistributorLevel,
  type Sale,
} from '../index'

const T0 = '2026-01-01T00:00:00.000Z'
const PAID = '2026-03-10T00:00:00.000Z'
const PERIOD_END = '2026-04-01T00:00:00.000Z'

function dist(id: string, parentId: string | null, level: DistributorLevel): Distributor {
  return { id, parentId, levelHistory: [{ level, effectiveFrom: T0 }] }
}

let seq = 0
function sale(sellerId: string, amountCents: number, extra: Partial<Sale> = {}): Sale {
  seq += 1
  return { id: `s${seq}`, sellerId, kind: 'plan', amountCents, paidAt: PAID, isSelfPurchase: false, ...extra }
}

function linesOf(stmt: ReturnType<typeof computeStatement>, id: string, kind: string): number {
  return stmt.lines.filter((l) => l.distributorId === id && l.kind === kind).reduce((s, l) => s + l.amountCents, 0)
}

describe('applyRate / teamRateFor', () => {
  it('floors positive amounts and mirrors refunds exactly', () => {
    expect(applyRate(79_900, 3500)).toBe(27_965)
    expect(applyRate(99_999, 3333)).toBe(33_329)
    expect(applyRate(-99_999, 3333)).toBe(-33_329)
  })

  it('uses the ladder boundaries agreed with the PM', () => {
    expect(teamRateFor(4_999_999, RULES)).toBe(0)
    expect(teamRateFor(5_000_000, RULES)).toBe(600)
    expect(teamRateFor(14_999_999, RULES)).toBe(600)
    expect(teamRateFor(15_000_000, RULES)).toBe(800)
    expect(teamRateFor(100_000_000, RULES)).toBe(1600)
    expect(teamRateFor(500_000_000, RULES)).toBe(1600)
  })
})

describe('retail and peer commission', () => {
  it('pays retail by the seller level at sale time', () => {
    const distributors = [dist('n', null, 'standard'), dist('t', null, 'tier1'), dist('p', null, 'premier')]
    const periodSales = [sale('n', 79_900), sale('t', 79_900), sale('p', 79_900)]
    const stmt = computeStatement({ distributors, periodSales, allSales: periodSales, periodEnd: PERIOD_END, rules: RULES })
    expect(linesOf(stmt, 'n', 'retail')).toBe(15_980)
    expect(linesOf(stmt, 't', 'retail')).toBe(23_970)
    expect(linesOf(stmt, 'p', 'retail')).toBe(27_965)
  })

  it('pays 5% peer to the nearest same-level upline only', () => {
    const distributors = [dist('a', null, 'tier1'), dist('b', 'a', 'premier'), dist('c', 'b', 'tier1'), dist('d', 'c', 'tier1')]
    const periodSales = [sale('d', 79_900)]
    const stmt = computeStatement({ distributors, periodSales, allSales: periodSales, periodEnd: PERIOD_END, rules: RULES })
    expect(linesOf(stmt, 'c', 'peer')).toBe(3_995)
    expect(linesOf(stmt, 'a', 'peer')).toBe(0)
    expect(stmt.lines.filter((l) => l.kind === 'peer')).toHaveLength(1)
  })

  it('skips a higher-level intermediate and finds the same-level upline above it', () => {
    const distributors = [dist('a', null, 'tier1'), dist('b', 'a', 'premier'), dist('c', 'b', 'tier1')]
    const periodSales = [sale('c', 79_900)]
    const stmt = computeStatement({ distributors, periodSales, allSales: periodSales, periodEnd: PERIOD_END, rules: RULES })
    expect(linesOf(stmt, 'a', 'peer')).toBe(3_995)
    expect(linesOf(stmt, 'b', 'peer')).toBe(0)
  })

  it('claws back a refund at the level of the original sale, even after an upgrade', () => {
    const seller: Distributor = {
      id: 'x',
      parentId: null,
      levelHistory: [
        { level: 'standard', effectiveFrom: T0 },
        { level: 'premier', effectiveFrom: '2026-03-20T00:00:00.000Z' },
      ],
    }
    const original = sale('x', 79_900)
    const refund = sale('x', -79_900, { kind: 'refund', refundOfSaleId: original.id, paidAt: '2026-03-25T00:00:00.000Z' })
    const stmt = computeStatement({ distributors: [seller], periodSales: [refund], allSales: [original, refund], periodEnd: PERIOD_END, rules: RULES })
    expect(linesOf(stmt, 'x', 'retail')).toBe(-15_980)
  })

  it('rejects a refund whose original sale is unknown', () => {
    const refund = sale('x', -100, { kind: 'refund', refundOfSaleId: 'missing' })
    expect(() => computeStatement({ distributors: [dist('x', null, 'standard')], periodSales: [refund], allSales: [refund], periodEnd: PERIOD_END, rules: RULES }))
      .toThrow(DistributorTreeError)
  })
})

describe('team differential commission', () => {
  it('reproduces the worked example in the spec (A → B → C)', () => {
    const distributors = [dist('A', null, 'premier'), dist('B', 'A', 'tier1'), dist('C', 'B', 'standard')]
    const periodSales = [sale('C', 6_000_000), sale('B', 10_000_000), sale('A', 2_000_000)]
    const stmt = computeStatement({ distributors, periodSales, allSales: periodSales, periodEnd: PERIOD_END, rules: RULES })
    expect(linesOf(stmt, 'C', 'team')).toBe(360_000)
    expect(linesOf(stmt, 'B', 'team')).toBe(920_000)
    expect(linesOf(stmt, 'A', 'team')).toBe(160_000)
    const teamTotal = stmt.lines.filter((l) => l.kind === 'team').reduce((s, l) => s + l.amountCents, 0)
    expect(teamTotal).toBe(1_440_000) // 8% × 180,000
  })

  it('never pays more than the top rate on the whole tree (randomised trees)', () => {
    let state = 42
    const rand = (n: number): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
      return state % n
    }
    for (let trial = 0; trial < 50; trial += 1) {
      const distributors: Distributor[] = [dist('r', null, 'standard')]
      const sales: Sale[] = []
      for (let i = 1; i < 30; i += 1) {
        distributors.push(dist(`d${i}`, distributors[rand(i)].id, 'standard'))
      }
      for (const d of distributors) sales.push(sale(d.id, rand(8_000_000)))
      const index = indexDistributors(distributors)
      const result = teamLines(sales, index, RULES, new Set())
      const total = result.lines.reduce((s, l) => s + l.amountCents, 0)
      expect(total).toBe(result.grossCents.get('r'))
      for (const line of result.lines) expect(line.amountCents).toBeGreaterThan(0)
    }
  })

  it('pays an upline nothing when its team sits on the same step as its only child', () => {
    const distributors = [dist('A', null, 'tier1'), dist('B', 'A', 'standard')]
    const periodSales = [sale('B', 20_000_000)]
    const stmt = computeStatement({ distributors, periodSales, allSales: periodSales, periodEnd: PERIOD_END, rules: RULES })
    expect(stmt.lines.find((l) => l.distributorId === 'A' && l.kind === 'team')).toBeUndefined()
    expect(stmt.lines.find((l) => l.distributorId === 'B' && l.kind === 'team')?.payable).toBe(true)
  })

  it('marks an inactive upline team line as not payable', () => {
    const distributors = [dist('A', null, 'tier1'), dist('B', 'A', 'standard'), dist('C', 'A', 'standard')]
    const periodSales = [sale('B', 10_000_000), sale('C', 10_000_000)]
    const stmt = computeStatement({ distributors, periodSales, allSales: periodSales, periodEnd: PERIOD_END, rules: RULES })
    const aTeam = stmt.lines.find((l) => l.distributorId === 'A' && l.kind === 'team')
    expect(aTeam?.amountCents).toBe(400_000) // 8% × 200k − 2 × 6% × 100k
    expect(aTeam?.payable).toBe(false)
    expect(stmt.payableByDistributor.get('A') ?? 0).toBe(0)
  })
})

describe('tree validation', () => {
  it('rejects unknown parents and cycles', () => {
    expect(() => indexDistributors([dist('a', 'ghost', 'standard')])).toThrow(DistributorTreeError)
    expect(() => indexDistributors([dist('a', 'b', 'standard'), dist('b', 'a', 'standard')])).toThrow(DistributorTreeError)
  })
})
