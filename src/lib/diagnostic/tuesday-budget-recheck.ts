import type { SupabaseClient } from '@supabase/supabase-js'
import { checkBudgetWithinSafeRange } from '@/lib/meta/guardrails'
import { planCut } from '@/lib/ads-strategy/stop-loss'
import { O1_MIN_DAYS } from '@/lib/ads-strategy/portfolio/opportunities/o1-hot-creative'
import { ADS_RULE_MIN_STREAK, ADS_RULE_STALE_DAYS, ADS_RULE_STREAK_GAP_DAYS, dayGap, streakFor, type GrowthStateRow, type RuleFinding } from '@/lib/ads-strategy/rules/patrol-findings'
import { readApprovedDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { budgetEntityKey, readKernelPreBudget } from '@/lib/capabilities/ads/envelope-facts'
import { readStepRatio } from '@/lib/ads-budget-card/ratio'
import type { BudgetOrder, BudgetSnapshot, StepRatio } from '@/lib/ads-budget-card/types'
const ADSET_RE = /^\d{1,32}$/
const ACCOUNT_RE = /^act_\d{6,20}$/
const LOOKBACK_DAYS = 14
const STATE_LIMIT = 500
export interface TuesdaySuggestion {
  clientId: string; subjectKey: string; direction: 'increase' | 'decrease'; accountLabel: string
  beforeCents: number; afterCents: number; currencyLabel: string; why: string; dateLabel: string
  scopeLabel: string; adsetId: string; adAccountId: string; prescriptionId: string; name: string | null
}
export interface SupervisionState {
  clientId: string; date: string; dataCompleteness: 'complete' | 'partial' | null
  problems: RuleFinding[]; opportunities: RuleFinding[]
}
type BudgetIntent =
  | { kind: 'none' }
  | { kind: 'block'; reason: string }
  | { kind: 'need'; direction: 'increase' | 'decrease'; unitId: string }
interface UnitRead {
  budgetLevel: string | null; cents: number | null; active: boolean; currency: string | null
  capturedAt: string | null; accountRemainingCents: number | null; clientRemainingCents: number | null
  headroomReadable: boolean; adAccountId: string | null; name: string | null; stepRatio?: StepRatio
}
export function budgetIntent(states: readonly SupervisionState[], now: Date): BudgetIntent {
  const rows = [...states].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const newest = rows[0]
  if (!newest) return { kind: 'none' }
  const fresh = freshness(newest, now)
  if (fresh !== 'ok') return staleOrPartial(newest, fresh)
  return intentFromHits(rows)
}
export function boundedBudgetAfter(
  direction: 'increase' | 'decrease',
  before: number,
  remaining: number | null,
  ratio: number,
): { after: number } | { blocked: string } {
  if (direction === 'decrease') return boundedCut(before, ratio)
  if (!Number.isSafeInteger(remaining) || (remaining ?? -1) < 0) {
    return { blocked: '账户或客户的剩余日预算算不出，这次不加。' }
  }
  const raw = Math.round(before * (1 + ratio))
  if (!Number.isSafeInteger(raw) || raw <= before) return { blocked: '按允许幅度算不出更高的日预算，这次不出卡。' }
  const available = before + (remaining as number)
  if (!Number.isSafeInteger(available)) return { blocked: '账户或客户的剩余日预算算不出，这次不加。' }
  const target = raw > available ? available : raw
  if (target <= before) return { blocked: '已经到日预算上限，这次不加。' }
  if (!checkBudgetWithinSafeRange(before, target, ratio).ok) return { blocked: '加幅超出一次允许的范围，这次不出卡。' }
  return { after: target }
}
export function normalAdAccount(value: string | null): string | null {
  if (!value) return null
  const text = value.trim()
  if (ACCOUNT_RE.test(text)) return text
  if (/^\d{6,20}$/.test(text)) return `act_${text}`
  return null
}
export function numericAdset(value: string): boolean {
  return ADSET_RE.test(value)
}
function freshness(row: SupervisionState, now: Date): 'ok' | 'partial' | 'stale' {
  if (row.dataCompleteness === 'partial') return 'partial'
  const today = now.toISOString().slice(0, 10)
  return dayGap(row.date, today) > ADS_RULE_STALE_DAYS ? 'stale' : 'ok'
}
function staleOrPartial(row: SupervisionState, fresh: 'partial' | 'stale'): BudgetIntent {
  if (!hasMoneyHit(row)) return { kind: 'none' }
  const reason = fresh === 'partial'
    ? '广告巡检数据没拉全，这次不出加减预算的卡。'
    : '广告巡检太旧，这次不出加减预算的卡。'
  return { kind: 'block', reason }
}
function intentFromHits(rows: readonly SupervisionState[]): BudgetIntent {
  const newest = rows[0]
  if (!newest) return { kind: 'none' }
  if (hitWithoutAdset(newest)) return { kind: 'block', reason: '巡检没有说清是哪一组，这次不出卡。' }
  const cuts = qualified(rows, 'decrease')
  const raises = qualified(rows, 'increase')
  if (cuts.length > 0 && raises.length > 0) {
    return { kind: 'block', reason: '同一周既该加预算又该减预算，这次先不出卡。' }
  }
  const chosen = cuts.length > 0 ? cuts : raises
  if (chosen.length > 1) return { kind: 'block', reason: '有不止一处要调，这次先不出卡。' }
  if (chosen.length === 0) return { kind: 'none' }
  return { kind: 'need', direction: cuts.length === 1 ? 'decrease' : 'increase', unitId: chosen[0] }
}
function qualified(rows: readonly SupervisionState[], direction: 'increase' | 'decrease'): string[] {
  const newest = rows[0]
  if (!newest) return []
  if (direction === 'decrease') {
    return adsetIds(newest.problems, 'D3').filter((id) => (
      streakFor(`D3:${id}`, rows.map(toGrowth)) >= ADS_RULE_MIN_STREAK
    ))
  }
  return adsetIds(newest.opportunities, 'O1').filter((id) => o1Streak(id, rows) >= O1_MIN_DAYS)
}
function o1Streak(unitId: string, rows: readonly SupervisionState[]): number {
  let streak = 0
  let last: string | null = null
  for (const row of rows) {
    if (!adsetIds(row.opportunities, 'O1').includes(unitId)) break
    if (last !== null && dayGap(row.date, last) > ADS_RULE_STREAK_GAP_DAYS) break
    streak += 1
    last = row.date
  }
  return streak
}
function toGrowth(row: SupervisionState): GrowthStateRow {
  return {
    client_id: row.clientId,
    date: row.date,
    payload: { dataCompleteness: row.dataCompleteness ?? undefined, problems: row.problems },
  }
}
function hasMoneyHit(row: SupervisionState): boolean {
  return adsetIds(row.problems, 'D3').length > 0 || adsetIds(row.opportunities, 'O1').length > 0 || hitWithoutAdset(row)
}
function hitWithoutAdset(row: SupervisionState): boolean {
  return [...row.problems, ...row.opportunities].some((finding) => (
    (finding.code === 'D3' || finding.code === 'O1')
    && finding.status === 'hit'
    && adsetIds([finding], finding.code).length === 0
  ))
}
function adsetIds(findings: readonly RuleFinding[], code: string): string[] {
  const ids: string[] = []
  for (const finding of findings) {
    if (finding.code !== code || finding.status !== 'hit') continue
    for (const unit of finding.units ?? []) {
      if (unit.level === 'adset' && unit.id && !ids.includes(unit.id)) ids.push(unit.id)
    }
  }
  return ids
}
function boundedCut(before: number, ratio: number): { after: number } | { blocked: string } {
  const cut = planCut(before, ratio)
  if (cut.newCents === null) return { blocked: '再减就会低于还能投的最低日预算，这次不出卡。' }
  if (cut.newCents >= before || !checkBudgetWithinSafeRange(before, cut.newCents, ratio).ok) {
    return { blocked: '减幅不在允许范围内，这次不出卡。' }
  }
  return { after: cut.newCents }
}
export async function loadSupervisionStates(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  now: Date,
): Promise<SupervisionState[] | { error: string }> {
  if (clientIds.length === 0) return []
  try {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('ads_growth_states')
      .select('client_id, date, data_completeness, payload')
      .in('client_id', [...clientIds])
      .gte('date', since)
      .order('date', { ascending: false })
      .limit(STATE_LIMIT)
    if (error) return { error: '广告巡检读不到，这次不出加减预算的卡。' }
    const rows = data ?? []
    if (rows.length >= STATE_LIMIT) return { error: '巡检记录一次读不完，这次不出卡。' }
    return rows.map(mapState)
  } catch {
    return { error: '广告巡检读不到，这次不出加减预算的卡。' }
  }
}
export async function loadTuesdayUnit(
  supabase: SupabaseClient,
  clientId: string,
  unitId: string,
  direction: 'increase' | 'decrease',
  prescriptionId: string,
  now: Date,
): Promise<UnitRead | { error: string }> {
  const snap = await latestAdset(supabase, clientId, unitId)
  if ('error' in snap) return snap
  const stepRatio = await readStepRatio(supabase, clientId, now).catch(() => 'unreadable' as const)
  const head = direction === 'increase'
    ? await increaseHeadroom(supabase, clientId, snap.accountId, unitId, snap.cents, prescriptionId, now)
    : { accountRemainingCents: null, clientRemainingCents: null, headroomReadable: false }
  if ('error' in head) return head
  return {
    budgetLevel: snap.budgetLevel,
    cents: snap.cents,
    active: snap.active,
    currency: snap.currency,
    capturedAt: snap.capturedAt,
    adAccountId: snap.accountId,
    name: snap.name,
    stepRatio,
    ...head,
  }
}
/** Cross-account snapshot the budget card guard already requires. Missing data blocks. */
export async function loadTuesdaySnapshot(
  supabase: SupabaseClient,
  clientId: string,
  order: BudgetOrder,
  now: Date,
): Promise<BudgetSnapshot | { blocked: string }> {
  const snap = await latestAdset(supabase, clientId, order.adsetId)
  if ('error' in snap) return { blocked: snap.error }
  const raising = Number.isSafeInteger(snap.cents) && order.newDailyBudgetCents > (snap.cents as number)
  const unit = await loadTuesdayUnit(
    supabase, clientId, order.adsetId, raising ? 'increase' : 'decrease', order.prescriptionId, now,
  )
  if ('error' in unit) return { blocked: unit.error }
  return rollupSnapshot(supabase, clientId, order, unit, now)
}
async function rollupSnapshot(
  supabase: SupabaseClient,
  clientId: string,
  order: BudgetOrder,
  unit: UnitRead,
  now: Date,
): Promise<BudgetSnapshot | { blocked: string }> {
  const accountId = normalAdAccount(unit.adAccountId)
  if (!accountId || !Number.isSafeInteger(unit.cents) || (unit.cents ?? 0) <= 0) {
    return { blocked: '现日预算读不到，没有按 0 出卡。' }
  }
  const cap = await readApprovedDailyTotalCap(supabase, clientId, order.prescriptionId).catch(() => null)
  if (!cap) return { blocked: '已批准的计划读不出来，没有出卡。' }
  if (!cap.ok) return { blocked: cap.reason }
  const rollup = await readKernelPreBudget(
    supabase, clientId, accountId, 'adset', order.adsetId, unit.cents as number, now, cap.cents,
  ).catch(() => null)
  if (!rollup) return { blocked: '账户和客户总预算核算不完整，这次不出卡。' }
  if (!rollup.ok) return { blocked: rollup.reason }
  const other = rollup.budget.clientLiveCents - rollup.budget.accountLiveCents
  if (!Number.isSafeInteger(other) || other < 0) return { blocked: '其它广告账户现在的日预算读不到，这次不出卡。' }
  const countedInLive = rollup.budget.countedLive.has(budgetEntityKey(accountId, 'adset', order.adsetId))
  return { registeredAccountIds: [accountId], accountId, adsetId: order.adsetId, status: unit.active ? 'ACTIVE' : null, currentCents: unit.cents, name: unit.name, accountCapCents: rollup.budget.accountCapCents, accountLiveCents: rollup.budget.accountLiveCents, countedInLive, otherAccountsLiveCents: other, clientCapCents: rollup.budget.clientCapCents, lifetimeBlocks: false, stepRatio: unit.stepRatio ?? 'unreadable' }
}
async function latestAdset(supabase: SupabaseClient, clientId: string, unitId: string): Promise<{ error: string } | { accountId: string | null; cents: number | null; budgetLevel: string | null; active: boolean; currency: string | null; capturedAt: string | null; name: string | null }> {
  try {
    const { data, error } = await supabase.from('ad_entity_snapshots').select('ad_account_id, daily_budget_minor, budget_level, effective_status, currency, captured_at, entity_name').eq('client_id', clientId).eq('platform', 'meta').eq('level', 'adset').eq('entity_id', unitId).order('captured_at', { ascending: false }).limit(1).maybeSingle()
    if (error) return { error: '日预算读不到，没有按 0 出卡。' }
    if (!data) return { error: '现日预算读不到，没有按 0 出卡。' }
    return { accountId: text(data.ad_account_id), cents: numberOrNull(data.daily_budget_minor), budgetLevel: text(data.budget_level), active: data.effective_status === 'ACTIVE', currency: text(data.currency), capturedAt: text(data.captured_at), name: text(data.entity_name) }
  } catch {
    return { error: '日预算读不到，没有按 0 出卡。' }
  }
}
async function increaseHeadroom(
  supabase: SupabaseClient,
  clientId: string,
  accountId: string | null,
  unitId: string,
  cents: number | null,
  prescriptionId: string,
  now: Date,
): Promise<{ accountRemainingCents: number | null; clientRemainingCents: number | null; headroomReadable: boolean } | { error: string }> {
  const account = normalAdAccount(accountId)
  if (!account || !Number.isSafeInteger(cents) || (cents ?? 0) <= 0) {
    return { error: '现日预算读不到，没有按 0 出卡。' }
  }
  try {
    const cap = await readApprovedDailyTotalCap(supabase, clientId, prescriptionId)
    if (!cap.ok) return { error: cap.reason }
    const rollup = await readKernelPreBudget(
      supabase, clientId, account, 'adset', unitId, cents as number, now, cap.cents,
    )
    if (!rollup.ok) return { error: rollup.reason }
    const accountRemaining = rollup.budget.accountCapCents - rollup.budget.accountLiveCents
    const clientRemaining = rollup.budget.clientCapCents - rollup.budget.clientLiveCents
    if (!Number.isSafeInteger(accountRemaining) || !Number.isSafeInteger(clientRemaining)) {
      return { error: '账户或客户的剩余日预算算不出，这次不加。' }
    }
    return { accountRemainingCents: accountRemaining, clientRemainingCents: clientRemaining, headroomReadable: true }
  } catch {
    return { error: '账户和客户总预算核算不完整，这次不加预算。' }
  }
}
function mapState(row: {
  client_id?: unknown
  date?: unknown
  data_completeness?: unknown
  payload?: unknown
}): SupervisionState {
  const payload = row.payload && typeof row.payload === 'object'
    ? row.payload as { problems?: unknown; opportunities?: unknown }
    : {}
  const completeness = row.data_completeness === 'partial' || row.data_completeness === 'complete'
    ? row.data_completeness
    : null
  return { clientId: typeof row.client_id === 'string' ? row.client_id : '', date: typeof row.date === 'string' ? row.date : '', dataCompleteness: completeness, problems: asFindings(payload.problems), opportunities: asFindings(payload.opportunities) }
}
function asFindings(value: unknown): SupervisionState['problems'] {
  if (!Array.isArray(value)) return []
  return value.flatMap(asFinding)
}
function asFinding(value: unknown): SupervisionState['problems'] {
  if (!value || typeof value !== 'object') return []
  const row = value as { code?: unknown; status?: unknown; units?: unknown }
  if (typeof row.code !== 'string' || typeof row.status !== 'string') return []
  const units = Array.isArray(row.units) ? row.units.flatMap(asUnit) : []
  return [{ code: row.code, status: row.status, title: '', units }]
}
function asUnit(value: unknown): NonNullable<SupervisionState['problems'][number]['units']> {
  if (!value || typeof value !== 'object') return []
  const row = value as { level?: unknown; id?: unknown }
  if (typeof row.level !== 'string' || typeof row.id !== 'string' || !row.id) return []
  return [{ level: row.level, id: row.id, name: null }]
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}
