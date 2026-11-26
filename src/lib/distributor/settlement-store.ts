/**
 * Monthly settlement, database part. Computing only records a statement ("computed"); paying needs a
 * person on the spend-approver list to approve it, and "mark paid" records money sent outside ME.
 * Nothing here moves money.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { AI_STEWARD_RULES_V1 } from './config'
import { monthEnd, planMonth, savePayload, toDistributors, toSales, type DistributorDbRow, type LevelDbRow, type SaleDbRow, type SettlementHistory } from './settlement'
import { ensureRuleVersion, fail, selectAll, DistributorStoreError } from './store'
import { nzOffset, toMs } from './time'
import type { SettledSaleInfo, TeamMonthEntry } from './types'

interface StatementRow { id: string; period_month: string; status: 'computed' | 'approved' | 'paid' | 'voided' }
interface BalanceRow { statement_id: string; distributor_id: string; closing_cents: number; team_rate_bp: number; team_paid: boolean }
interface UnpaidLineRow { statement_id: string; sale_id: string | null; kind: string; distributor_id: string }

const monthOf = (periodMonth: string): string => periodMonth.slice(0, 7)

/** Builds history from every live (non-voided) statement. Refuses if `month` or a later month is already live. */
export function buildHistory(
  month: string,
  statements: readonly StatementRow[],
  balances: readonly BalanceRow[],
  unpaidLines: readonly UnpaidLineRow[],
  sales: readonly SaleDbRow[],
): SettlementHistory {
  const live = statements.filter((s) => s.status !== 'voided')
  const blocking = live.find((s) => monthOf(s.period_month) >= month)
  if (blocking) {
    throw new DistributorStoreError(`a statement for ${monthOf(blocking.period_month)} already exists; void it first`, 409)
  }
  const liveById = new Map(live.map((s) => [s.id, s]))
  const teamByMonth = new Map<string, Map<string, TeamMonthEntry>>()
  for (const b of balances) {
    const st = liveById.get(b.statement_id)
    if (!st) continue
    const m = teamByMonth.get(monthOf(st.period_month)) ?? new Map<string, TeamMonthEntry>()
    m.set(b.distributor_id, { rateBp: b.team_rate_bp, paid: b.team_paid })
    teamByMonth.set(monthOf(st.period_month), m)
  }
  const settledSales = new Map<string, SettledSaleInfo>()
  for (const s of sales) {
    const st = s.settled_statement_id ? liveById.get(s.settled_statement_id) : undefined
    if (!st || s.kind === 'refund') {
      if (st) settledSales.set(s.id, { month: monthOf(st.period_month), unpaid: new Set() })
      continue
    }
    const unpaid = new Set(unpaidLines.filter((l) => l.statement_id === st.id && l.sale_id === s.id).map((l) => `${l.kind}:${l.distributor_id}`))
    settledSales.set(s.id, { month: monthOf(st.period_month), unpaid })
  }
  const latest = [...live].sort((a, b) => b.period_month.localeCompare(a.period_month))[0]
  const openingBalances = new Map<string, number>()
  for (const b of balances) if (latest && b.statement_id === latest.id && b.closing_cents < 0) openingBalances.set(b.distributor_id, b.closing_cents)
  return { teamByMonth, settledSales, openingBalances }
}

export interface ComputeResult {
  month: string
  dryRun: boolean
  statementId: string | null
  totalPayableCents: number
  salesSettled: number
  lines: number
  distributorsPaid: number
}

/** Computes one NZ month. dryRun = compute and report only, nothing is written. */
export async function computeMonth(month: string, dryRun: boolean): Promise<ComputeResult> {
  const [distributors, levels, sales, statements, balances, unpaidLines] = await Promise.all([
    selectAll<DistributorDbRow>('distributors', 'id, parent_id, status'),
    selectAll<LevelDbRow>('distributor_level_history', 'id, distributor_id, level, effective_from'),
    selectAll<SaleDbRow>('distributor_sales', 'id, distributor_id, kind, amount_cents, currency, paid_at, is_self_purchase, refund_of_sale_id, settled_statement_id'),
    selectAll<StatementRow>('distributor_statements', 'id, period_month, status'),
    selectAll<BalanceRow>('distributor_statement_balances', 'statement_id, distributor_id, closing_cents, team_rate_bp, team_paid', ['statement_id', 'distributor_id']),
    loadUnpaidLines(),
  ])
  const periodEnd = monthEnd(month, nzOffset)
  if (Date.now() < toMs(periodEnd)) throw new DistributorStoreError(`${month} is not over yet`, 409)
  const history = buildHistory(month, statements, balances, unpaidLines, sales)
  const plan = planMonth({
    month,
    periodEnd,
    distributors: toDistributors(distributors, levels),
    allSales: toSales(sales),
    history,
    rules: AI_STEWARD_RULES_V1,
  })
  const payload = savePayload(plan)
  // The statement references the rule version; make sure it exists and still matches the code.
  if (!dryRun) await ensureRuleVersion()
  const summary = {
    month,
    dryRun,
    totalPayableCents: payload.total_payable_cents,
    salesSettled: payload.sale_ids.length,
    lines: payload.lines.length,
    distributorsPaid: payload.balances.filter((b) => b.payout_cents > 0).length,
  }
  if (dryRun) return { ...summary, statementId: null }
  const { data, error } = await supabaseAdmin.rpc('distributor_save_statement', { p: payload })
  if (error) fail('save statement', error)
  return { ...summary, statementId: String(data) }
}

async function loadUnpaidLines(): Promise<UnpaidLineRow[]> {
  const rows: UnpaidLineRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('distributor_commission_lines')
      .select('id, statement_id, sale_id, kind, distributor_id')
      .eq('payable', false)
      .order('id')
      .range(from, from + 999)
    if (error) fail('list unpaid lines', error)
    const page = (data ?? []) as UnpaidLineRow[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

export type StatementAction = 'approve' | 'mark_paid' | 'void'

const NEXT: Record<StatementAction, { from: readonly StatementRow['status'][]; to: StatementRow['status'] }> = {
  approve: { from: ['computed'], to: 'approved' },
  mark_paid: { from: ['approved'], to: 'paid' },
  void: { from: ['computed', 'approved'], to: 'voided' },
}

/**
 * One step on a statement. Voiding is only allowed for the latest live statement (later ones depend on it).
 * Voiding an approved statement needs the payout approver: money may already have been sent outside ME,
 * and a void + recompute + approve by someone else would pay the same sales twice.
 */
export async function actOnStatement(
  id: string,
  action: StatementAction,
  actorEmail: string,
  opts: { actorIsPayoutApprover: boolean },
): Promise<StatementRow> {
  const { data: current, error } = await supabaseAdmin.from('distributor_statements').select('id, period_month, status').eq('id', id).maybeSingle()
  if (error) fail('load statement', error)
  if (!current) throw new DistributorStoreError('statement not found', 404)
  const st = current as StatementRow
  const step = NEXT[action]
  if (!step.from.includes(st.status)) throw new DistributorStoreError(`cannot ${action} a statement that is ${st.status}`, 409)
  if ((action !== 'void' || st.status === 'approved') && !opts.actorIsPayoutApprover) {
    throw new DistributorStoreError('only the payout approver can do this', 403)
  }
  if (action === 'void') {
    const later = await supabaseAdmin.from('distributor_statements').select('id').gt('period_month', st.period_month).neq('status', 'voided').limit(1)
    if (later.error) fail('check later statements', later.error)
    if ((later.data ?? []).length > 0) throw new DistributorStoreError('void the later statements first', 409)
  }
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { status: step.to }
  if (action === 'approve') Object.assign(patch, { approved_by: actorEmail, approved_at: now })
  if (action === 'mark_paid') patch.paid_at = now
  const { data, error: updateError } = await supabaseAdmin
    .from('distributor_statements').update(patch).eq('id', id).eq('status', st.status).select('id, period_month, status').maybeSingle()
  if (updateError) fail('update statement', updateError)
  if (!data) throw new DistributorStoreError('the statement changed meanwhile; reload and try again', 409)
  return data as StatementRow
}

export interface StatementListItem {
  id: string
  period_month: string
  status: StatementRow['status']
  total_payable_cents: number
  computed_at: string
  approved_by: string | null
  approved_at: string | null
  paid_at: string | null
  balances: Array<{ distributor_id: string; opening_cents: number; period_cents: number; payout_cents: number; closing_cents: number }>
}

export async function listStatements(): Promise<StatementListItem[]> {
  const { data, error } = await supabaseAdmin
    .from('distributor_statements')
    .select('id, period_month, status, total_payable_cents, computed_at, approved_by, approved_at, paid_at')
    .order('period_month', { ascending: false })
    .order('computed_at', { ascending: false })
    .limit(36)
  if (error) fail('list statements', error)
  const rows = (data ?? []) as Omit<StatementListItem, 'balances'>[]
  if (rows.length === 0) return []
  const balanceRows: Array<StatementListItem['balances'][number] & { statement_id: string }> = []
  for (let from = 0; ; from += 1000) {
    const b = await supabaseAdmin
      .from('distributor_statement_balances')
      .select('statement_id, distributor_id, opening_cents, period_cents, payout_cents, closing_cents')
      .in('statement_id', rows.map((r) => r.id))
      .order('statement_id')
      .order('distributor_id')
      .range(from, from + 999)
    if (b.error) fail('list statement balances', b.error)
    const page = (b.data ?? []) as typeof balanceRows
    balanceRows.push(...page)
    if (page.length < 1000) break
  }
  const byStatement = new Map<string, StatementListItem['balances']>()
  for (const r of balanceRows) {
    const { statement_id: sid, ...rest } = r
    byStatement.set(sid, [...(byStatement.get(sid) ?? []), rest])
  }
  return rows.map((r) => ({ ...r, balances: (byStatement.get(r.id) ?? []).filter((x) => x.period_cents !== 0 || x.opening_cents !== 0) }))
}
