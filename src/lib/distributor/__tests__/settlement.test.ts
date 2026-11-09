/**
 * Monthly settlement end to end without a database: month 1 is planned and "saved" (its payload is
 * turned back into the rows the store would read), then month 2 is planned from that history.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { AI_STEWARD_RULES_V1 as RULES } from '../config'
import { monthEnd, planMonth, previousMonth, savePayload, selectPeriodSales, toDistributors, toSales, type SaleDbRow } from '../settlement'
import { buildHistory } from '../settlement-store'
import { nzOffset } from '../time'

const D = [
  { id: 'A', parent_id: null, status: 'approved' as const },
  { id: 'B', parent_id: 'A', status: 'approved' as const },
]
const LEVELS = [
  { distributor_id: 'A', level: 'tier1' as const, effective_from: '2026-01-01T00:00:00Z' },
  { distributor_id: 'B', level: 'standard' as const, effective_from: '2026-01-01T00:00:00Z' },
]

function sale(id: string, seller: string, amount: number, paidAt: string, extra: Partial<SaleDbRow> = {}): SaleDbRow {
  return { id, distributor_id: seller, kind: 'plan', amount_cents: amount, currency: 'NZD', paid_at: paidAt, is_self_purchase: false, refund_of_sale_id: null, settled_statement_id: null, ...extra }
}

describe('month helpers', () => {
  it('ends a month at NZ midnight with the right offset', () => {
    expect(monthEnd('2026-11', nzOffset)).toBe('2026-12-01T00:00:00+13:00')
    expect(monthEnd('2026-12', nzOffset)).toBe('2027-01-01T00:00:00+13:00')
    expect(monthEnd('2027-04', nzOffset)).toBe('2027-05-01T00:00:00+12:00')
    expect(() => monthEnd('2026-13', nzOffset)).toThrow()
    expect(previousMonth('2027-01')).toBe('2026-12')
    expect(previousMonth('2026-11')).toBe('2026-10')
  })
})

describe('selectPeriodSales', () => {
  const end = monthEnd('2026-11', nzOffset)
  const sales = toSales([
    sale('old', 'B', 79_900, '2026-11-10T00:00:00Z'),
    sale('late', 'B', 79_900, '2026-11-25T00:00:00Z'), // not 14 days old at month end
    sale('rOld', 'B', -79_900, '2026-11-12T00:00:00Z', { kind: 'refund', refund_of_sale_id: 'old' }),
    sale('rLate', 'B', -100, '2026-11-26T00:00:00Z', { kind: 'refund', refund_of_sale_id: 'late' }),
  ])

  it('takes matured sales and refunds whose original settles now or earlier; holds the rest', () => {
    const picked = selectPeriodSales(sales, new Map(), end, RULES).map((s) => s.id)
    expect(picked.sort()).toEqual(['old', 'rOld'])
  })

  it('never re-settles a sale that is already settled', () => {
    const settled = new Map([['old', { month: '2026-10', unpaid: new Set<string>() }]])
    expect(selectPeriodSales(sales, settled, end, RULES).map((s) => s.id)).toEqual(['rOld'])
  })
})

describe('two months in a row', () => {
  it('carries team rates, settlement months and debts from month 1 into month 2', () => {
    const rows = [sale('s1', 'B', 10_000_000, '2026-10-05T00:00:00Z')]
    const m1 = planMonth({
      month: '2026-10',
      periodEnd: monthEnd('2026-10', nzOffset),
      distributors: toDistributors(D, LEVELS),
      allSales: toSales(rows),
      history: buildHistory('2026-10', [], [], [], rows),
      rules: RULES,
    })
    const p1 = savePayload(m1)
    expect(p1.sale_ids).toEqual(['s1'])
    // B: retail 20% × 100k = 2,000,000; team 6% × 100k = 600,000. A: same team step → 0 team; no peer (other level).
    expect(p1.balances.find((b) => b.distributor_id === 'B')?.payout_cents).toBe(2_600_000)
    expect(p1.total_payable_cents).toBe(2_600_000)

    // "Save" month 1: rows the store would read back.
    const statements = [{ id: 'st1', period_month: '2026-10-01', status: 'approved' as const }]
    const balances = p1.balances.map((b) => ({ statement_id: 'st1', distributor_id: b.distributor_id, closing_cents: b.closing_cents, team_rate_bp: b.team_rate_bp, team_paid: b.team_paid }))
    const settledRows = rows.map((r) => ({ ...r, settled_statement_id: 'st1' }))
    const refund = sale('r1', 'B', -10_000_000, '2026-11-03T00:00:00Z', { kind: 'refund', refund_of_sale_id: 's1' })
    const all = [...settledRows, refund]

    const m2 = planMonth({
      month: '2026-11',
      periodEnd: monthEnd('2026-11', nzOffset),
      distributors: toDistributors(D, LEVELS),
      allSales: toSales(all),
      history: buildHistory('2026-11', statements, balances, [], all),
      rules: RULES,
    })
    const p2 = savePayload(m2)
    expect(p2.sale_ids).toEqual(['r1'])
    const b = p2.balances.find((x) => x.distributor_id === 'B')
    expect(b).toMatchObject({ period_cents: -2_600_000, payout_cents: 0, closing_cents: -2_600_000 })
    expect(p2.total_payable_cents).toBe(0)
  })

  it('refuses to compute a month that already has a live statement, or one before a later live statement', () => {
    const statements = [{ id: 'st1', period_month: '2026-11-01', status: 'computed' as const }]
    expect(() => buildHistory('2026-11', statements, [], [], [])).toThrow(/already exists/)
    expect(() => buildHistory('2026-10', statements, [], [], [])).toThrow(/already exists/)
    expect(() => buildHistory('2026-11', [{ ...statements[0], status: 'voided' as const }], [], [], [])).not.toThrow()
  })

  it('treats sales in a voided statement as unsettled, and takes opening debt from the latest live statement only', () => {
    const statements = [
      { id: 'old', period_month: '2026-09-01', status: 'paid' as const },
      { id: 'new', period_month: '2026-10-01', status: 'approved' as const },
      { id: 'void', period_month: '2026-10-01', status: 'voided' as const },
    ]
    const balances = [
      { statement_id: 'old', distributor_id: 'B', closing_cents: -100, team_rate_bp: 0, team_paid: true },
      { statement_id: 'new', distributor_id: 'B', closing_cents: -50, team_rate_bp: 600, team_paid: false },
    ]
    const rows = [sale('x', 'B', 100, '2026-09-01T00:00:00Z', { settled_statement_id: 'void' })]
    const unpaid = [{ statement_id: 'new', sale_id: 'y', kind: 'retail', distributor_id: 'B' }]
    const rowsY = [...rows, sale('y', 'B', 100, '2026-09-20T00:00:00Z', { settled_statement_id: 'new' })]
    const h = buildHistory('2026-11', statements, balances, unpaid, rowsY)
    expect(h.settledSales.has('x')).toBe(false)
    expect(h.settledSales.get('y')).toEqual({ month: '2026-10', unpaid: new Set(['retail:B']) })
    expect(h.openingBalances.get('B')).toBe(-50)
    expect(h.teamByMonth.get('2026-10')?.get('B')).toEqual({ rateBp: 600, paid: false })
  })
})
