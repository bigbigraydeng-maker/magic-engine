/**
 * Monthly settlement, pure part: which sales belong to a month, how stored rows become engine input,
 * and what the database save looks like. No I/O — see settlement-store.ts.
 *
 * A sale settles in the first month whose end is at least `refundWindowDays` after it was paid.
 * A refund settles in the first month that has ended after it was paid AND in which its original is
 * (or already was) settled — so a refund inside the window always travels with its original.
 */
import { computeStatement, type Statement } from './commission'
import { toMs } from './time'
import type { CommissionRules, Distributor, DistributorLevel, Sale, SettledSaleInfo, TeamMonthEntry } from './types'

export class SettlementError extends Error {}

/** NZ month "YYYY-MM" → its exclusive end instant (first moment of the next NZ month), ISO with offset. */
export function monthEnd(month: string, nzOffsetFor: (date: string) => string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!m) throw new SettlementError(`invalid month ${month}`)
  const year = Number(m[1])
  const next = Number(m[2]) === 12 ? `${year + 1}-01` : `${year}-${String(Number(m[2]) + 1).padStart(2, '0')}`
  return `${next}-01T00:00:00${nzOffsetFor(`${next}-01`)}`
}

/** The month before "YYYY-MM". */
export function previousMonth(month: string): string {
  const [y, mo] = month.split('-').map(Number)
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
}

export function selectPeriodSales(
  allSales: readonly Sale[],
  settled: ReadonlyMap<string, SettledSaleInfo>,
  periodEnd: string,
  rules: CommissionRules,
): Sale[] {
  const end = toMs(periodEnd)
  const windowMs = rules.refundWindowDays * 86_400_000
  const sales = allSales.filter((s) => s.kind !== 'refund' && !settled.has(s.id) && toMs(s.paidAt) + windowMs <= end)
  const included = new Set(sales.map((s) => s.id))
  const refunds = allSales.filter((s) =>
    s.kind === 'refund'
    && !settled.has(s.id)
    && toMs(s.paidAt) < end
    && s.refundOfSaleId !== undefined
    && (settled.has(s.refundOfSaleId) || included.has(s.refundOfSaleId)),
  )
  return [...sales, ...refunds]
}

export interface DistributorDbRow {
  id: string
  parent_id: string | null
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
}

export interface LevelDbRow { distributor_id: string; level: DistributorLevel; effective_from: string }

export interface SaleDbRow {
  id: string
  distributor_id: string
  kind: 'plan' | 'addon' | 'refund'
  amount_cents: number
  currency: string
  paid_at: string
  is_self_purchase: boolean
  refund_of_sale_id: string | null
  settled_statement_id: string | null
}

/** Pending / rejected distributors never sold and are never uplines of sellers; they still sit in the tree. */
export function toDistributors(rows: readonly DistributorDbRow[], levels: readonly LevelDbRow[]): Distributor[] {
  const byId = new Map<string, LevelDbRow[]>()
  for (const l of levels) byId.set(l.distributor_id, [...(byId.get(l.distributor_id) ?? []), l])
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    suspended: r.status === 'suspended',
    levelHistory: (byId.get(r.id) ?? []).map((l) => ({ level: l.level, effectiveFrom: new Date(l.effective_from).toISOString() })),
  }))
}

export function toSales(rows: readonly SaleDbRow[]): Sale[] {
  return rows.map((r) => ({
    id: r.id,
    sellerId: r.distributor_id,
    kind: r.kind,
    amountCents: r.amount_cents,
    currency: r.currency,
    paidAt: new Date(r.paid_at).toISOString(),
    isSelfPurchase: r.is_self_purchase,
    ...(r.refund_of_sale_id ? { refundOfSaleId: r.refund_of_sale_id } : {}),
  }))
}

export interface SettlementHistory {
  teamByMonth: ReadonlyMap<string, ReadonlyMap<string, TeamMonthEntry>>
  settledSales: ReadonlyMap<string, SettledSaleInfo>
  openingBalances: ReadonlyMap<string, number>
}

export interface MonthPlan {
  month: string
  periodEnd: string
  periodSales: Sale[]
  statement: Statement
}

export function planMonth(input: {
  month: string
  periodEnd: string
  distributors: readonly Distributor[]
  allSales: readonly Sale[]
  history: SettlementHistory
  rules: CommissionRules
}): MonthPlan {
  const periodSales = selectPeriodSales(input.allSales, input.history.settledSales, input.periodEnd, input.rules)
  const statement = computeStatement({
    distributors: input.distributors,
    periodSales,
    allSales: input.allSales,
    periodEnd: input.periodEnd,
    rules: input.rules,
    teamByMonth: input.history.teamByMonth,
    settledSales: input.history.settledSales,
    openingBalances: input.history.openingBalances,
  })
  if (statement.periodMonth !== input.month) {
    throw new SettlementError(`period end ${input.periodEnd} does not close month ${input.month}`)
  }
  return { month: input.month, periodEnd: input.periodEnd, periodSales, statement }
}

/** JSON for distributor_save_statement(p). */
export function savePayload(plan: MonthPlan) {
  const { statement } = plan
  const balances = [...statement.balances].map(([id, b]) => ({
    distributor_id: id,
    opening_cents: b.openingCents,
    period_cents: b.periodCents,
    payout_cents: b.payoutCents,
    closing_cents: b.closingCents,
    team_sales_cents: statement.teamSalesCents.get(id) ?? 0,
    team_rate_bp: statement.teamMonth.get(id)?.rateBp ?? 0,
    team_paid: statement.teamMonth.get(id)?.paid ?? true,
  }))
  return {
    period_month: `${plan.month}-01`,
    rule_version: statement.rulesVersion,
    total_payable_cents: balances.reduce((sum, b) => sum + b.payout_cents, 0),
    balances,
    lines: statement.lines.map((l) => ({
      distributor_id: l.distributorId,
      kind: l.kind,
      sale_id: l.saleId ?? '',
      amount_cents: l.amountCents,
      payable: l.payable,
      note: l.note,
    })),
    sale_ids: plan.periodSales.map((s) => s.id),
  }
}

export type SavePayload = ReturnType<typeof savePayload>
