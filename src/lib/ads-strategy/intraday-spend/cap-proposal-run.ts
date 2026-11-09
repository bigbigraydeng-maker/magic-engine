import type { SupabaseClient } from '@supabase/supabase-js'
import { agreedPlanDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { budgetOrderKey } from '@/lib/ads-budget-card/facts'
import { insertHold, type BudgetHold } from '@/lib/ads-budget-card/ledger'
import { budgetStepIdempotencyKey } from '@/lib/ads-budget-card/path'
import type { BudgetOrder } from '@/lib/ads-budget-card/types'
import { loadApprovedLock } from '@/lib/ads-budget-card/prescription-lock'
import { listApprovedIds } from '@/lib/ads-pause-card/load'
import { BREAKER_ACTION } from '@/lib/ads-strategy/circuit-breaker/apply'
import { issueConfirmationCard } from '@/lib/confirmation-card'
import { createKernel } from '@/lib/kernel'
import type { KernelDeps } from '@/lib/kernel/deps'
import { getActiveClientsWithMetaAccounts } from '@/lib/meta/client-ad-accounts'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { loadRecentSamples } from './db'
import { accountDayKey } from './sample'
import { sinceDay } from './view'
import {
  NZ_TZ,
  OBSERVATION_WINDOW_DAYS,
  applyCapDecision,
  decreaseWithinStep,
  describePlan,
  judgeIntradayCap,
  nzDayExpiresAt,
  paceSignal,
  subjectFor,
  type CapFacts,
  type CapGap,
  type CapPorts,
  type CapReceipt,
  type CardPlan,
  type LiveBudget,
  type SampleSignal,
  type SnapshotSignal,
} from './cap-proposal'
export async function runLiveCapProposal(sb: SupabaseClient, now: Date): Promise<CapReceipt> {
  const kernel = createKernel(sb)
  const clients = await getActiveClientsWithMetaAccounts(sb)
  const totals = { cards: 0, todos: 0, failed: 0 }
  for (const client of clients) {
    const one = await oneClient(sb, kernel, client.id, now)
    totals.cards += one.cards
    totals.todos += one.todos
    if (one.action === 'failed') totals.failed += 1
  }
  return { cards: totals.cards, todos: totals.todos, action: `${totals.cards} cards, ${totals.todos} todos` }
}
async function oneClient(
  sb: SupabaseClient,
  kernel: KernelDeps,
  clientId: string,
  now: Date,
): Promise<CapReceipt> {
  try {
    const facts = await loadFacts(sb, clientId, now)
    return applyCapDecision(judgeIntradayCap(facts), portsFor(sb, kernel, clientId))
  } catch {
    return { cards: 0, todos: 0, action: 'failed' }
  }
}
function portsFor(sb: SupabaseClient, kernel: KernelDeps, clientId: string): CapPorts {
  return {
    open: (day) => cardOpen(sb, clientId, day),
    issue: (plan) => issuePlan(sb, kernel, clientId, plan),
    todo: (code, summary, day) => writeTodo(sb, clientId, code, summary, day),
  }
}
async function loadFacts(sb: SupabaseClient, clientId: string, now: Date): Promise<CapFacts> {
  const [plan, sample, snapshot] = await Promise.all([
    readPlan(sb, clientId),
    readSample(sb, clientId, now),
    readSnapshot(sb, clientId),
  ])
  return { now, nzDay: accountDayKey(NZ_TZ, now), planCount: plan.count, capCents: plan.capCents, sample, snapshot }
}
async function readPlan(
  sb: SupabaseClient,
  clientId: string,
): Promise<{ count: number | null; capCents: number | null }> {
  const { data, error } = await sb.from('marketing_plans')
    .select('status, plan_data')
    .eq('client_id', clientId)
    .eq('status', 'approved')
    .limit(20)
  if (error || (data ?? []).length >= 20) return { count: null, capCents: null }
  const rows = (data ?? []) as { plan_data?: unknown }[]
  const cap = agreedPlanDailyTotalCap(rows)
  return { count: rows.length, capCents: cap.state === 'set' ? cap.cents : null }
}
async function readSample(sb: SupabaseClient, clientId: string, now: Date): Promise<SampleSignal> {
  const rows = await loadRecentSamples(sb, clientId, sinceDay(now))
  if (rows === null) {
    return { readable: false, latestAt: null, accountDay: null, spendMinor: null, forecastMinor: null }
  }
  return { readable: true, ...paceSignal(rows, now) }
}
async function readSnapshot(sb: SupabaseClient, clientId: string): Promise<SnapshotSignal> {
  const capture = await latestCaptures(sb, clientId)
  if (!capture.ok) return unreadableSnap()
  const budgets = await latestBudgets(sb, clientId)
  return { ...capture.signal, budgets }
}
function unreadableSnap(): SnapshotSignal {
  return { readable: false, capturedAt: null, complete: false, error: null, budgets: null }
}
async function cardOpen(sb: SupabaseClient, clientId: string, day: string): Promise<boolean> {
  const { data, error } = await sb.from('action_runs').select('id')
    .eq('client_id', clientId)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .eq('input->>subject_key', subjectFor(day))
    .limit(1)
  if (error) return true
  return (data ?? []).length > 0
}
async function issuePlan(
  sb: SupabaseClient,
  kernel: KernelDeps,
  clientId: string,
  plan: CardPlan,
): Promise<boolean> {
  const expiresAt = nzDayExpiresAt(plan.day)
  if (!expiresAt) return false
  const attach = await canAttach(sb, clientId, plan)
  const card = await issueConfirmationCard(kernel, {
    clientId,
    clicker: { kind: 'agent', email: 'intraday-cap@internal' },
    facts: describePlan(plan, attach),
    expiresAt,
  })
  if (attach) await attachHold(sb, clientId, plan, card.runId, card.fingerprint, card.expectedDecisionId).catch(() => undefined)
  return true
}
async function canAttach(sb: SupabaseClient, clientId: string, plan: CardPlan): Promise<boolean> {
  if (plan.action === 'pause') return Boolean(plan.campaignId && plan.accountId)
  if (plan.action !== 'decrease' || !plan.adsetId || !plan.accountId) return false
  if (!decreaseWithinStep(plan.beforeMinor ?? 0, plan.afterMinor ?? 0)) return false
  const ids = await listApprovedIds(sb, clientId)
  return ids !== 'unreadable' && ids.length === 1
}
async function attachHold(
  sb: SupabaseClient,
  clientId: string,
  plan: CardPlan,
  runId: string,
  fingerprint: string,
  decisionId: string,
): Promise<void> {
  if (plan.action === 'pause') {
    await insertPause(sb, clientId, plan, runId, fingerprint, decisionId)
    return
  }
  await insertDecrease(sb, clientId, plan, runId, fingerprint)
}
async function insertDecrease(sb: SupabaseClient, clientId: string, plan: CardPlan, runId: string, fingerprint: string): Promise<void> {
  const ids = await listApprovedIds(sb, clientId)
  if (ids === 'unreadable' || ids.length !== 1 || !plan.adsetId || !plan.accountId) return
  const locked = await loadApprovedLock(sb, clientId, ids[0] as string)
  if (!locked.ok || plan.beforeMinor === null || plan.afterMinor === null) return
  const order = orderOf(ids[0] as string, plan)
  const key = budgetStepIdempotencyKey(clientId, order, plan.beforeMinor, locked.lock)
  if (!key) return
  await insertHold(sb, clientId, holdOf(order, locked.lock, key, runId, fingerprint, plan))
}
function orderOf(prescriptionId: string, plan: CardPlan): BudgetOrder {
  return { prescriptionId, adsetId: plan.adsetId as string, adAccountId: plan.accountId as string, newDailyBudgetCents: plan.afterMinor as number, name: plan.name, expectedMetric: 'ads.account.spend', direction: 'down', observationWindowDays: OBSERVATION_WINDOW_DAYS }
}
function holdOf(order: BudgetOrder, lock: BudgetHold['lock'], idempotencyKey: string, runId: string, fingerprint: string, plan: CardPlan): BudgetHold {
  return { kind: 'adset_daily_budget', status: 'holding', cardRunId: runId, subjectKey: subjectFor(plan.day), fingerprint, orderKey: budgetOrderKey(order), order, lock, idempotencyKey, beforeCents: plan.beforeMinor as number, afterCents: plan.afterMinor as number, direction: 'down', observationWindowDays: OBSERVATION_WINDOW_DAYS, confirmedBy: null, actionRunId: null, readbackCents: null, readbackMatched: null, writeAttempted: false, wroteMeta: false }
}
async function insertPause(sb: SupabaseClient, clientId: string, plan: CardPlan, runId: string, fingerprint: string, decisionId: string): Promise<void> {
  const name = plan.name?.replace(/[{}[\]`]/g, '').trim().slice(0, 40) || '在投的广告系列'
  const before = { status: 'ACTIVE', name, daily_budget: null }
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId, execution_item_id: null, flywheel: 'ads', action_type: ADS_ACTION_TYPE.PAUSE_CAMPAIGN, execution_mode: 'third_party', vendor: 'meta', expected_metric: null,
    payload: { status: 'holding', kind: 'pause', cardRunId: runId, fingerprint, expectedDecisionId: decisionId, campaign_id: plan.campaignId, ad_account_id: plan.accountId, objective: null, before, after: before, wrote: false, requestedBy: 'intraday-cap@internal', executionItemId: null },
  })
  if (error) throw new Error(error.message)
}
async function writeTodo(sb: SupabaseClient, clientId: string, code: CapGap, summary: string, day: string): Promise<boolean> {
  const subjectKey = `alert:intraday_cap:${code}:${day}`
  const { data, error } = await sb.from('flywheel_actions').select('id').eq('client_id', clientId).eq('action_type', BREAKER_ACTION).eq('payload->>subject_key', subjectKey).limit(1)
  if (error || (data ?? []).length > 0) return false
  const { error: insertError } = await sb.from('flywheel_actions').insert({
    client_id: clientId, execution_item_id: null, flywheel: 'ads', action_type: BREAKER_ACTION, execution_mode: 'third_party', vendor: 'meta', expected_metric: null,
    payload: { subject_key: subjectKey, status: 'alert_only', summary, card_run_id: null, wrote: false, rules: [code], day, campaign_name: '' },
  })
  return !insertError
}
async function latestCaptures(sb: SupabaseClient, clientId: string): Promise<{ ok: true; signal: Omit<SnapshotSignal, 'budgets'> } | { ok: false }> {
  const { data, error } = await sb.from('ad_snapshot_captures')
    .select('ad_account_id, captured_at, complete, error')
    .eq('client_id', clientId)
    .in('level', ['campaign', 'adset'])
    .order('captured_at', { ascending: false })
    .limit(80)
  if (error || (data ?? []).length >= 80) return { ok: false }
  return { ok: true, signal: captureSignal((data ?? []) as CaptureRow[]) }
}
function captureSignal(rows: readonly CaptureRow[]): Omit<SnapshotSignal, 'budgets'> {
  const latest = new Map<string, CaptureRow>()
  for (const row of rows) if (!latest.has(row.ad_account_id)) latest.set(row.ad_account_id, row)
  const picked = [...latest.values()]
  if (picked.length === 0) return { readable: true, capturedAt: null, complete: false, error: null }
  const broken = picked.find((row) => row.error || row.complete !== true)
  const times = picked.map((row) => row.captured_at).sort()
  return { readable: true, capturedAt: times[0] ?? null, complete: !broken, error: broken?.error ?? null }
}
async function latestBudgets(sb: SupabaseClient, clientId: string): Promise<readonly LiveBudget[] | null> {
  const { data, error } = await sb.from('ad_entity_snapshots')
    .select('ad_account_id, level, entity_id, entity_name, campaign_id, effective_status, daily_budget_minor, lifetime_budget_minor')
    .eq('client_id', clientId)
    .in('level', ['campaign', 'adset'])
    .order('captured_at', { ascending: false })
    .limit(400)
  if (error || (data ?? []).length >= 400) return null
  return budgetRows((data ?? []) as SnapRow[])
}
function budgetRows(rows: readonly SnapRow[]): LiveBudget[] {
  const seen = new Set<string>()
  const out: LiveBudget[] = []
  for (const row of rows) {
    const key = `${row.level}:${row.entity_id}`
    if (seen.has(key) || row.level !== 'campaign' && row.level !== 'adset') continue
    seen.add(key)
    const daily = asMinor(row.daily_budget_minor)
    if (asMinor(row.lifetime_budget_minor) !== null || daily === null) continue
    out.push({ level: row.level, id: row.entity_id, campaignId: row.campaign_id, accountId: row.ad_account_id, name: row.entity_name ?? '', dailyMinor: daily, active: row.effective_status === 'ACTIVE' })
  }
  return out
}
const STALE_CONFIRM = '最新花费不再显示会超过每天上限，或数据已经旧了，没有改。'

export async function intradayConfirmRefusal(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
  action: 'decrease' | 'pause',
): Promise<string | null> {
  try {
    const decision = judgeIntradayCap(await loadFacts(sb, clientId, now))
    if (decision.kind === 'card' && decision.action === action) return null
  } catch {
    return STALE_CONFIRM
  }
  return STALE_CONFIRM
}

function asMinor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}
interface CaptureRow { ad_account_id: string; captured_at: string; complete: boolean; error: string | null }
interface SnapRow { ad_account_id: string; level: string; entity_id: string; entity_name: string | null; campaign_id: string | null; effective_status: string | null; daily_budget_minor: number | string | null; lifetime_budget_minor: number | string | null }
