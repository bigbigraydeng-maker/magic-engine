/**
 * 周二任务：复查已经批准、正在执行的方案。
 *
 * 不生成方案，不批准，不调用落地。调整建议只写进人话，不改任何方案、
 * 不改广告、不花钱、不发布、不给客户发消息。
 * 回执由调用方写进这条任务本来就有的运行记录，今日待办再读那段人话。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getExecutionSummaryForGoal } from '@/lib/strategy/initiatives'
import {
  countLinkedAdDrafts,
  countPrescriptionActions,
  countWorkOrders,
  describePrescriptionCheck,
  finiteNumber,
  pickInActPrescriptions,
  type ActionCounts,
  type AdDraftCounts,
  type MeasuredKpi,
  type MetricFact,
  type PrescriptionCheckFacts,
  type WorkOrderCounts,
} from './prescription-weekly-check-text'

export const PRESCRIPTION_WEEKLY_CHECK_KIND = 'prescription_weekly_check'

const READ_LIMIT = 500

export interface WeeklyCheckOutcome {
  clientId: string
  clientName: string
  result: 'checked' | 'skipped' | 'error'
  prescriptionId?: string
  goalId?: string | null
  goalTitle?: string | null
  progress?: string
  suggestion?: string
  detail?: string
}

export interface WeeklyCheckSummary {
  considered: number
  checked: number
  outcomes: WeeklyCheckOutcome[]
}

interface ApprovedRow {
  id: string
  client_id: string
  goal_id: string | null
  status: string
  approved_at: string | null
}

interface ClientRow {
  id: string
  name: string | null
  client_status: string | null
  industry: string | null
}

interface GoalFactRow {
  id: string
  title: string | null
  primary_metric_label: string | null
  baseline_value: unknown
  current_value: unknown
  target_value: unknown
  target_direction: string | null
  current_value_fetched_at: string | null
}

interface ItemRow {
  id: string
  prescription_id: string | null
  client_id: string
  status: string | null
}

interface OrderRow {
  id: string
  client_id: string
  goal_id: string | null
  status: string | null
}

interface DraftRow {
  execution_item_id: string | null
  client_id: string
  action_type: string | null
  payload: unknown
}

interface OutcomeRow {
  prescription_id: string
  client_id: string
  kpi_metric: string | null
  actual_value: unknown
  target_value: unknown
  unit: string | null
  measured_at: string | null
}

export async function runPrescriptionWeeklyCheck(
  supabase: SupabaseClient,
): Promise<WeeklyCheckSummary> {
  const approved = pickInActPrescriptions(await loadApproved(supabase))
  const clients = await loadClients(supabase, unique(approved.map((row) => row.client_id)))
  const skipped: WeeklyCheckOutcome[] = []
  const live: ApprovedRow[] = []
  for (const row of approved) {
    const skip = skipReason(clients.get(row.client_id))
    if (skip) {
      skipped.push(skippedOutcome(row, clients, skip))
      continue
    }
    live.push(row)
  }
  const checked = await checkLive(supabase, live, clients)
  return {
    considered: approved.length,
    checked: checked.filter((row) => row.result === 'checked').length,
    outcomes: [...skipped, ...checked],
  }
}

async function checkLive(
  supabase: SupabaseClient,
  live: ApprovedRow[],
  clients: Map<string, ClientRow>,
): Promise<WeeklyCheckOutcome[]> {
  if (live.length === 0) return []
  const bundle = await loadBundle(supabase, live)
  const outcomes: WeeklyCheckOutcome[] = []
  for (const row of live) {
    outcomes.push(checkOne(row, clients, bundle))
  }
  return outcomes
}

function checkOne(
  row: ApprovedRow,
  clients: Map<string, ClientRow>,
  bundle: FactBundle,
): WeeklyCheckOutcome {
  const clientName = clients.get(row.client_id)?.name || row.client_id
  try {
    const text = describePrescriptionCheck(factsFor(row, bundle))
    return {
      clientId: row.client_id,
      clientName,
      result: 'checked',
      prescriptionId: row.id,
      goalId: row.goal_id,
      goalTitle: bundle.goals.get(row.goal_id ?? '')?.title ?? null,
      progress: text.progress,
      suggestion: text.suggestion,
    }
  } catch (error) {
    return {
      clientId: row.client_id,
      clientName,
      result: 'error',
      prescriptionId: row.id,
      goalId: row.goal_id,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

interface FactBundle {
  goals: Map<string, GoalFactRow>
  items: ItemRow[]
  orders: OrderRow[]
  drafts: DraftRow[]
  kpis: OutcomeRow[]
  stages: Map<string, StageFact>
  readsCapped: boolean
}

interface StageFact {
  known: boolean
  initiativeCount: number
  actions: ActionCounts | null
  campaigns: { total: number } | null
}

async function loadBundle(supabase: SupabaseClient, live: ApprovedRow[]): Promise<FactBundle> {
  const ids = live.map((row) => row.id)
  const goalIds = unique(live.map((row) => row.goal_id).filter((id): id is string => !!id))
  const [goals, items, orders, kpis] = await Promise.all([
    fetchIn<GoalFactRow>(supabase, 'goals', GOAL_COLUMNS, 'id', goalIds),
    fetchIn<ItemRow>(supabase, 'execution_items', 'id, prescription_id, client_id, status', 'prescription_id', ids),
    fetchIn<OrderRow>(supabase, 'content_work_orders', 'id, client_id, goal_id, status', 'goal_id', goalIds),
    fetchIn<OutcomeRow>(supabase, 'prescription_outcomes', 'prescription_id, client_id, kpi_metric, actual_value, target_value, unit, measured_at', 'prescription_id', ids),
  ])
  const itemIds = items.map((row) => row.id)
  const drafts = await fetchIn<DraftRow>(
    supabase,
    'flywheel_actions',
    'execution_item_id, client_id, action_type, payload',
    'execution_item_id',
    itemIds,
  )
  return {
    goals: new Map(goals.map((row) => [row.id, row])),
    items,
    orders,
    drafts: drafts.filter((row) => row.action_type === 'ads.create_ad'),
    kpis,
    stages: await loadStages(supabase, goalIds),
    readsCapped: [goals, items, orders, kpis, drafts].some((rows) => rows.length >= READ_LIMIT),
  }
}

async function loadStages(supabase: SupabaseClient, goalIds: string[]): Promise<Map<string, StageFact>> {
  const stages = new Map<string, StageFact>()
  for (const goalId of goalIds) {
    stages.set(goalId, await stageFact(supabase, goalId))
  }
  return stages
}

async function stageFact(supabase: SupabaseClient, goalId: string): Promise<StageFact> {
  const summary = await getExecutionSummaryForGoal(supabase, goalId)
  if (!summary) return { known: false, initiativeCount: 0, actions: null, campaigns: null }
  const actions: ActionCounts = {
    completed: summary.totalCompleted,
    inProgress: summary.totalInProgress,
    pending: summary.totalPending,
    skipped: summary.totalSkipped,
    superseded: 0,
    other: otherActions(summary),
  }
  return {
    known: true,
    initiativeCount: summary.initiativeCount,
    actions,
    campaigns: { total: summary.totalCampaigns },
  }
}

function otherActions(summary: {
  totalActions: number
  totalCompleted: number
  totalInProgress: number
  totalPending: number
  totalSkipped: number
}): number {
  const known = summary.totalCompleted + summary.totalInProgress + summary.totalPending + summary.totalSkipped
  return Math.max(0, summary.totalActions - known)
}

function factsFor(row: ApprovedRow, bundle: FactBundle): PrescriptionCheckFacts {
  const goal = row.goal_id ? bundle.goals.get(row.goal_id) ?? null : null
  const stage = row.goal_id ? bundle.stages.get(row.goal_id) ?? null : null
  const ownItems = bundle.items.filter((item) => item.prescription_id === row.id && item.client_id === row.client_id)
  const ownIds = new Set(ownItems.map((item) => item.id))
  return {
    goalTitle: goal?.title ?? null,
    goalLinked: !!row.goal_id,
    approvedOn: row.approved_at,
    initiativesKnown: stage?.known ?? false,
    initiativeCount: stage?.initiativeCount ?? 0,
    goalActions: stage?.actions ?? null,
    prescriptionActions: countPrescriptionActions(ownItems.map((item) => item.status ?? '')),
    workOrders: workOrdersFor(row, bundle.orders),
    adDrafts: draftsFor(row.client_id, ownIds, bundle.drafts),
    campaigns: stage?.campaigns ?? null,
    metric: metricFor(goal),
    measuredKpis: kpisFor(row, bundle.kpis),
    readsCapped: bundle.readsCapped,
  }
}

function workOrdersFor(row: ApprovedRow, orders: OrderRow[]): WorkOrderCounts | null {
  if (!row.goal_id) return null
  const statuses = orders
    .filter((order) => order.goal_id === row.goal_id && order.client_id === row.client_id)
    .map((order) => order.status ?? '')
  return countWorkOrders(statuses)
}

function draftsFor(clientId: string, itemIds: Set<string>, drafts: DraftRow[]): AdDraftCounts {
  const payloads = drafts
    .filter((row) => row.client_id === clientId && row.execution_item_id != null && itemIds.has(row.execution_item_id))
    .map((row) => row.payload)
  return countLinkedAdDrafts(payloads)
}

function metricFor(goal: GoalFactRow | null): MetricFact | null {
  if (!goal) return null
  return {
    label: goal.primary_metric_label?.trim() || '目标数字',
    baseline: finiteNumber(goal.baseline_value),
    current: finiteNumber(goal.current_value),
    target: finiteNumber(goal.target_value),
    direction: goal.target_direction === 'decrease' ? 'decrease' : 'increase',
    fetchedOn: goal.current_value_fetched_at,
  }
}

function kpisFor(row: ApprovedRow, kpis: OutcomeRow[]): MeasuredKpi[] {
  const newest = new Map<string, OutcomeRow>()
  const mine = kpis
    .filter((kpi) => kpi.prescription_id === row.id && kpi.client_id === row.client_id)
    .sort((a, b) => (b.measured_at ?? '').localeCompare(a.measured_at ?? ''))
  for (const kpi of mine) {
    const name = kpi.kpi_metric?.trim()
    if (!name || newest.has(name)) continue
    newest.set(name, kpi)
  }
  return Array.from(newest.values()).slice(0, 3).map((kpi) => ({
    metric: kpi.kpi_metric?.trim() || '指标',
    actual: finiteNumber(kpi.actual_value),
    target: finiteNumber(kpi.target_value),
    unit: kpi.unit,
  }))
}

function skipReason(client: ClientRow | undefined): string | null {
  if (!client) return '查不到这个客户'
  if (client.client_status !== 'active') return `客户状态是「${client.client_status ?? '空'}」，不是进行中的付费客户`
  if (!client.industry?.trim()) return '没填行业，按内部账号处理，这周不复查'
  return null
}

function skippedOutcome(
  row: ApprovedRow,
  clients: Map<string, ClientRow>,
  detail: string,
): WeeklyCheckOutcome {
  return {
    clientId: row.client_id,
    clientName: clients.get(row.client_id)?.name || row.client_id,
    result: 'skipped',
    prescriptionId: row.id,
    goalId: row.goal_id,
    detail,
  }
}

async function loadApproved(supabase: SupabaseClient): Promise<ApprovedRow[]> {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('id, client_id, goal_id, status, approved_at')
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(READ_LIMIT)
  if (error) throw new Error(`已批准方案读取失败：${error.message}`)
  return (data ?? []) as ApprovedRow[]
}

async function loadClients(supabase: SupabaseClient, ids: string[]): Promise<Map<string, ClientRow>> {
  const rows = await fetchIn<ClientRow>(supabase, 'clients', 'id, name, client_status, industry', 'id', ids)
  return new Map(rows.map((row) => [row.id, row]))
}

const GOAL_COLUMNS = 'id, title, primary_metric_label, baseline_value, current_value, target_value, target_direction, current_value_fetched_at'

async function fetchIn<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  ids: string[],
): Promise<T[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from(table).select(columns).in(column, ids).limit(READ_LIMIT)
  if (error) throw new Error(`${table} 读取失败：${error.message}`)
  return (data ?? []) as T[]
}

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids))
}
