/**
 * Read the facts Tuesday supervision already trusts.
 * This file does not write a budget and does not call Meta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readApprovedDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { budgetEntityKey, readKernelPreBudget } from '@/lib/capabilities/ads/envelope-facts'
import { readStepRatio } from '@/lib/ads-budget-card/ratio'
import type { BudgetOrder, BudgetSnapshot } from '@/lib/ads-budget-card/types'
import { fillTuesdayBudgets, normalAdAccount, type SupervisionState, type UnitRead } from './tuesday-budget-amount'
import type { WeeklyCheckSummary } from './prescription-weekly-check'

const LOOKBACK_DAYS = 14
const STATE_LIMIT = 500

export async function attachTuesdayBudgetAmounts(
  supabase: SupabaseClient,
  summary: WeeklyCheckSummary,
  now: Date,
): Promise<WeeklyCheckSummary> {
  return fillTuesdayBudgets(summary, {
    loadStates: (clientIds) => loadSupervisionStates(supabase, clientIds, now),
    loadUnit: (clientId, unitId, direction, prescriptionId) => (
      loadTuesdayUnit(supabase, clientId, unitId, direction, prescriptionId, now)
    ),
  }, now)
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
  return {
    registeredAccountIds: [accountId],
    accountId,
    adsetId: order.adsetId,
    status: unit.active ? 'ACTIVE' : null,
    currentCents: unit.cents,
    name: unit.name,
    accountCapCents: rollup.budget.accountCapCents,
    accountLiveCents: rollup.budget.accountLiveCents,
    countedInLive: rollup.budget.countedLive.has(budgetEntityKey(accountId, 'adset', order.adsetId)),
    otherAccountsLiveCents: other,
    clientCapCents: rollup.budget.clientCapCents,
    lifetimeBlocks: false,
    stepRatio: unit.stepRatio ?? 'unreadable',
  }
}

async function latestAdset(
  supabase: SupabaseClient,
  clientId: string,
  unitId: string,
): Promise<{ error: string } | {
  accountId: string | null
  cents: number | null
  budgetLevel: string | null
  active: boolean
  currency: string | null
  capturedAt: string | null
  name: string | null
}> {
  try {
    const { data, error } = await supabase
      .from('ad_entity_snapshots')
      .select('ad_account_id, daily_budget_minor, budget_level, effective_status, currency, captured_at, entity_name')
      .eq('client_id', clientId)
      .eq('platform', 'meta')
      .eq('level', 'adset')
      .eq('entity_id', unitId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return { error: '日预算读不到，没有按 0 出卡。' }
    if (!data) return { error: '现日预算读不到，没有按 0 出卡。' }
    return {
      accountId: text(data.ad_account_id),
      cents: numberOrNull(data.daily_budget_minor),
      budgetLevel: text(data.budget_level),
      active: data.effective_status === 'ACTIVE',
      currency: text(data.currency),
      capturedAt: text(data.captured_at),
      name: text(data.entity_name),
    }
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
  return {
    clientId: typeof row.client_id === 'string' ? row.client_id : '',
    date: typeof row.date === 'string' ? row.date : '',
    dataCompleteness: completeness,
    problems: asFindings(payload.problems),
    opportunities: asFindings(payload.opportunities),
  }
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
