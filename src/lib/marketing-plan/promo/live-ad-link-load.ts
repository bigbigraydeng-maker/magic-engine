/**
 * Read the live-ad link from rows already in this database.
 * Does not call Meta, and does not write ads, budgets, or approval times.
 */
import { supabaseAdmin } from '@/lib/supabase'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import { readSupersededBy } from './supersede-prior-approved'
import {
  budgetChangesFromSnapshots, describeLiveAdLink, parseBudgetApproval, parseLaunchReceipts, pickCurrentApprovedPlan, readMinor,
  type BudgetApproval, type LinkAdset, type PlanRow,
} from './live-ad-link'
import {
  captureTrustKey,
  fieldChangesFromSnapshots,
  type AdsetSnapshotRow,
  type MeLedgerEntry,
} from './live-ad-snapshot-diff'

const BUDGET_KEYS = ['ads.scale_unit_budget', 'ads.cut_unit_budget', 'ads.cut_campaign_budget']
const LEDGER_KEYS = [...BUDGET_KEYS, 'ads.pause_unit', 'ads.pause_campaign']
const ACTION_CAP = 500
const SNAPSHOT_CAP = 2000
const UNREADABLE = ['在投广告和已批准计划的对上关系这次没读出来。']
const CAPPED = ['开投回执太多，这次没有逐条对，不能判断谁没有批准记录。']

export async function loadLiveAdLink(clientId: string, now: Date = new Date()): Promise<{ lines: string[] }> {
  try {
    return { lines: await buildLink(clientId, now) }
  } catch {
    return { lines: UNREADABLE }
  }
}

async function buildLink(clientId: string, now: Date): Promise<string[]> {
  const labels = await accountLabels(clientId)
  const adsets = await liveAdsets(clientId, labels, now)
  const actions = await launchRows(clientId)
  if (actions === 'capped') return CAPPED
  const ids = adsets.map(adset => adset.id)
  const [history, trusted, meLedger, approvals] = await Promise.all([
    budgetHistory(clientId, ids),
    trustedCaptureKeys(clientId),
    meLedgerEntries(clientId),
    budgetApprovals(clientId),
  ])
  const fieldChanges = fieldChangesFromSnapshots(history.rows, trusted)
  return describeLiveAdLink({
    plan: pickCurrentApprovedPlan(await approvedPlans(clientId)),
    adsets,
    receipts: parseLaunchReceipts(actions),
    changes: budgetChangesFromSnapshots(history.rows),
    fieldChanges,
    approvals,
    meLedger,
    changesTruncated: history.truncated,
  })
}

async function accountLabels(clientId: string): Promise<Record<string, string | null>> {
  const labels: Record<string, string | null> = {}
  for (const raw of await eqRows('client_meta_ad_accounts', 'ad_account_id, label', [['client_id', clientId]])) {
    const id = str(rec(raw)?.ad_account_id)
    if (id !== '') labels[norm(id)] = text(rec(raw)?.label)
  }
  return labels
}

async function liveAdsets(clientId: string, labels: Record<string, string | null>, now: Date): Promise<LinkAdset[]> {
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString()
  const { data, error } = await supabaseAdmin.from('ad_entity_snapshots')
    .select('entity_id, ad_account_id, entity_name, campaign_id, effective_status, capture_reason, captured_at')
    .eq('client_id', clientId).eq('level', 'adset').gte('captured_at', since)
    .order('captured_at', { ascending: false }).limit(SNAPSHOT_CAP)
  if (error) throw new Error(error.message)
  const seen = new Set<string>()
  const out: LinkAdset[] = []
  for (const raw of Array.isArray(data) ? data : []) {
    const row = rec(raw)
    const id = str(row?.entity_id)
    if (!row || id === '' || seen.has(id) || !isLive(text(row.effective_status), text(row.capture_reason))) continue
    seen.add(id)
    const accountId = str(row.ad_account_id)
    out.push({
      id,
      name: text(row.entity_name),
      campaignId: text(row.campaign_id),
      accountLabel: labels[accountId] ?? labels[norm(accountId)] ?? null,
    })
  }
  return out
}

function isLive(status: string | null, reason: string | null): boolean {
  return status === 'ACTIVE' && reason !== 'disappeared'
}

async function launchRows(clientId: string): Promise<{ id: string; payload: unknown }[] | 'capped'> {
  const data = await eqRows('flywheel_actions', 'id, payload', [['client_id', clientId], ['action_type', 'ads.create_ad']], ACTION_CAP)
  if (data.length >= ACTION_CAP) return 'capped'
  return data.flatMap(raw => {
    const id = str(rec(raw)?.id)
    return id === '' ? [] : [{ id, payload: rec(raw)?.payload }]
  })
}

async function approvedPlans(clientId: string): Promise<PlanRow[]> {
  const data = await eqRows('marketing_plans', 'id, title, status, approved_at, generation_meta', [['client_id', clientId], ['status', 'approved']])
  return data.flatMap(raw => {
    const row = rec(raw)
    const id = str(row?.id)
    if (!row || id === '') return []
    return [{
      id,
      title: str(row.title),
      status: str(row.status),
      approvedAt: text(row.approved_at),
      superseded: readSupersededBy(metaOf(row.generation_meta)) !== null,
    }]
  })
}

async function budgetHistory(clientId: string, ids: readonly string[]) {
  if (ids.length === 0) return { rows: [] as AdsetSnapshotRow[], truncated: false }
  const { data, error } = await supabaseAdmin.from('ad_entity_snapshots')
    .select('entity_id, ad_account_id, captured_at, daily_budget_minor, effective_status')
    .eq('client_id', clientId).eq('level', 'adset').in('entity_id', [...ids])
    .order('captured_at', { ascending: false }).limit(SNAPSHOT_CAP)
  if (error) throw new Error(error.message)
  const rows = (Array.isArray(data) ? data : []).flatMap(raw => {
    const row = rec(raw)
    const entityId = str(row?.entity_id)
    const capturedAt = str(row?.captured_at)
    const adAccountId = str(row?.ad_account_id)
    if (!row || entityId === '' || capturedAt === '' || adAccountId === '') return []
    return [{
      entityId,
      adAccountId,
      capturedAt,
      dailyBudgetMinor: readMinor(row.daily_budget_minor),
      effectiveStatus: text(row.effective_status),
    }]
  })
  return { rows, truncated: rows.length >= SNAPSHOT_CAP }
}

async function trustedCaptureKeys(clientId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('ad_snapshot_captures')
    .select('ad_account_id, captured_at, complete, error')
    .eq('client_id', clientId).eq('level', 'adset').eq('complete', true).is('error', null)
    .order('captured_at', { ascending: false }).limit(SNAPSHOT_CAP)
  if (error) throw new Error(error.message)
  const keys = new Set<string>()
  for (const raw of Array.isArray(data) ? data : []) {
    const row = rec(raw)
    const account = str(row?.ad_account_id)
    const at = str(row?.captured_at)
    if (account !== '' && at !== '') keys.add(captureTrustKey(account, at))
  }
  return keys
}

async function meLedgerEntries(clientId: string): Promise<MeLedgerEntry[]> {
  const { data, error } = await supabaseAdmin.from('action_runs')
    .select('id, action_key, input, finished_at')
    .eq('client_id', clientId).eq('status', 'succeeded').in('action_key', LEDGER_KEYS).limit(200)
  if (error) throw new Error(error.message)
  const rawRuns = Array.isArray(data) ? data : []
  if (rawRuns.length >= 200) throw new Error('ledger runs capped')
  const runs = rawRuns.flatMap(raw => {
    const row = rec(raw)
    const id = str(row?.id)
    const actionKey = str(row?.action_key)
    const finishedAt = text(row?.finished_at)
    if (!row || id === '' || actionKey === '' || finishedAt === null) return []
    const input = rec(row.input)
    return [{
      runId: id,
      actionKey,
      finishedAt,
      input,
    }]
  })
  const passed = await passedRuns(runs.map(run => run.runId))
  return runs.flatMap(run => {
    if (!passed.has(run.runId)) return []
    const input = run.input
    return [{
      runId: run.runId,
      actionKey: run.actionKey,
      adSetId: text(input?.adset_id),
      campaignId: text(input?.campaign_id),
      finishedAt: run.finishedAt,
      afterMinor: readMinor(input?.after_cents),
    }]
  })
}

async function budgetApprovals(clientId: string): Promise<BudgetApproval[]> {
  const { data, error } = await supabaseAdmin.from('action_runs')
    .select('id, input, finished_at, authorization_decision_id')
    .eq('client_id', clientId).eq('status', 'succeeded').in('action_key', BUDGET_KEYS).limit(200)
  if (error) throw new Error(error.message)
  const rawRuns = Array.isArray(data) ? data : []
  if (rawRuns.length >= 200) throw new Error('budget runs capped')
  const runs = rawRuns.flatMap(raw => {
    const row = rec(raw)
    const id = str(row?.id)
    if (!row || id === '') return []
    return [{ id, input: row.input, finishedAt: text(row.finished_at), decisionId: text(row.authorization_decision_id) }]
  })
  const passed = await passedRuns(runs.map(run => run.id))
  const decisions = await decisionTimes(runs.flatMap(run => (run.decisionId ? [run.decisionId] : [])))
  return runs.flatMap(run => {
    const parsed = parseBudgetApproval({
      id: run.id,
      input: run.input,
      finishedAt: run.finishedAt,
      decisionAt: run.decisionId ? decisions.get(run.decisionId) ?? null : null,
      readbackPassed: passed.has(run.id),
    })
    return parsed ? [parsed] : []
  })
}

async function passedRuns(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabaseAdmin.from('action_run_steps')
    .select('run_id, verification').eq('step_key', 'readback').in('run_id', [...ids])
  if (error) throw new Error(error.message)
  const passed = new Set<string>()
  for (const raw of Array.isArray(data) ? data : []) {
    const row = rec(raw)
    const id = str(row?.run_id)
    if (id !== '' && rec(row?.verification)?.passed === true) passed.add(id)
  }
  return passed
}

async function decisionTimes(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabaseAdmin.from('authorization_decisions').select('id, created_at').in('id', [...ids])
  if (error) throw new Error(error.message)
  const times = new Map<string, string>()
  for (const raw of Array.isArray(data) ? data : []) {
    const id = str(rec(raw)?.id)
    const at = str(rec(raw)?.created_at)
    if (id !== '' && at !== '') times.set(id, at)
  }
  return times
}

function metaOf(value: unknown): MarketingPlan['generation_meta'] {
  const raw = rec(rec(value)?.superseded_by)
  const planId = str(raw?.plan_id)
  const at = str(raw?.at)
  return planId === '' || at === '' ? {} : { superseded_by: { plan_id: planId, at } }
}

async function eqRows(table: string, columns: string, filters: readonly (readonly [string, string])[], limit = SNAPSHOT_CAP): Promise<unknown[]> {
  let query = supabaseAdmin.from(table).select(columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  const { data, error } = await query.limit(limit)
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

function norm(raw: string): string {
  return `act_${raw.replace(/^act_/, '')}`
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function text(value: unknown): string | null {
  const trimmed = str(value)
  return trimmed === '' ? null : trimmed
}
