import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseDraft,
  parseGoal,
  parseOutcome,
  parsePlan,
  parsePrescription,
  parseStrategy,
  parseWorkOrder,
} from './parse'
import type {
  ChainFacts,
  DraftFact,
  GoalFact,
  Loaded,
  OutcomeFact,
  PlanFact,
  StrategyFact,
  WorkOrderFact,
} from './types'

const READ_CAP = 200

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

interface ChainQuery extends PromiseLike<QueryResult> {
  select(columns: string): ChainQuery
  eq(column: string, value: string): ChainQuery
  in(column: string, values: readonly string[]): ChainQuery
  order(column: string, options: { ascending: boolean }): ChainQuery
  limit(count: number): ChainQuery
  maybeSingle(): Promise<QueryResult>
}

export interface ChainReader {
  from(table: string): ChainQuery
}

export interface LoadChainInput {
  clientId: string
  prescriptionId: string
  nowIso: string
}

async function readQuery(query: PromiseLike<QueryResult>): Promise<QueryResult> {
  try {
    return await query
  } catch {
    return { data: null, error: { message: 'read failed' } }
  }
}

async function readMaybe(query: ChainQuery): Promise<Loaded<unknown>> {
  const { data, error } = await readQuery(query.maybeSingle())
  if (error) return { read: 'unread' }
  return { read: 'ok', value: data ?? null }
}

async function readList(query: ChainQuery): Promise<Loaded<unknown[]>> {
  const { data, error } = await readQuery(query.limit(READ_CAP + 1))
  if (error || !Array.isArray(data) || data.length > READ_CAP) return { read: 'unread' }
  return { read: 'ok', value: data }
}

function plansFrom(rows: Loaded<unknown[]>): Loaded<PlanFact[]> {
  if (rows.read !== 'ok') return rows.read === 'skipped' ? { read: 'skipped' } : { read: 'unread' }
  const plans: PlanFact[] = []
  for (const row of rows.value) {
    const plan = parsePlan(row)
    if (!plan) return { read: 'unread' }
    plans.push(plan)
  }
  return { read: 'ok', value: plans }
}

function ordersFrom(rows: Loaded<unknown[]>): Loaded<WorkOrderFact[]> {
  if (rows.read !== 'ok') return { read: 'unread' }
  const orders: WorkOrderFact[] = []
  for (const row of rows.value) {
    const order = parseWorkOrder(row)
    if (!order) return { read: 'unread' }
    orders.push(order)
  }
  return { read: 'ok', value: orders }
}

function configFrom(row: Loaded<unknown>): { outcome: Loaded<OutcomeFact | null>; strategy: Loaded<StrategyFact | null> } {
  if (row.read !== 'ok') return { outcome: { read: 'unread' }, strategy: { read: 'unread' } }
  if (row.value === null) {
    return {
      outcome: { read: 'ok', value: { configured: false, targetCostPerPrimary: null } },
      strategy: { read: 'ok', value: { dailyCapCents: null, pool: [] } },
    }
  }
  const strategy = parseStrategy(row.value)
  if (!strategy) return { outcome: { read: 'unread' }, strategy: { read: 'unread' } }
  return { outcome: { read: 'ok', value: parseOutcome(row.value) }, strategy: { read: 'ok', value: strategy } }
}

function goalFrom(row: Loaded<unknown>): Loaded<GoalFact | null> {
  if (row.read !== 'ok') return row.read === 'skipped' ? { read: 'skipped' } : { read: 'unread' }
  if (row.value === null) return { read: 'ok', value: null }
  const goal = parseGoal(row.value)
  return goal ? { read: 'ok', value: goal } : { read: 'unread' }
}

function snapshotFrom(row: Loaded<unknown>): ChainFacts['snapshot'] {
  if (row.read !== 'ok') return { read: 'unread' }
  if (row.value === null) return { read: 'ok', value: null }
  if (!row.value || typeof row.value !== 'object') return { read: 'unread' }
  const captured = (row.value as { captured_at?: unknown }).captured_at
  if (typeof captured !== 'string' || captured.trim() === '') return { read: 'unread' }
  return { read: 'ok', value: { capturedAt: captured } }
}

async function readDrafts(db: ChainReader, clientId: string, prescriptionId: string): Promise<Loaded<DraftFact[]>> {
  const items = await readList(
    db.from('execution_items').select('id').eq('prescription_id', prescriptionId).eq('client_id', clientId),
  )
  if (items.read !== 'ok') return { read: 'unread' }
  const ids: string[] = []
  for (const row of items.value) {
    if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') return { read: 'unread' }
    ids.push((row as { id: string }).id)
  }
  if (ids.length === 0) return { read: 'ok', value: [] }
  const actions = await readList(
    db.from('flywheel_actions').select('payload').eq('client_id', clientId).eq('action_type', 'ads.create_ad').in('execution_item_id', ids),
  )
  if (actions.read !== 'ok') return { read: 'unread' }
  return { read: 'ok', value: actions.value.map(parseDraft) }
}

function prescriptionFrom(row: Loaded<unknown>): ChainFacts['prescription'] {
  if (row.read !== 'ok') return { read: 'unread' }
  if (row.value === null) return { read: 'ok', value: null }
  const parsed = parsePrescription(row.value)
  return parsed ? { read: 'ok', value: parsed } : { read: 'unread' }
}

export async function loadChainFacts(db: ChainReader, input: LoadChainInput): Promise<ChainFacts> {
  const prescription = prescriptionFrom(await readMaybe(
    db.from('prescriptions')
      .select('status, goal_id, approved_at, error_message, intake, content')
      .eq('id', input.prescriptionId)
      .eq('client_id', input.clientId),
  ))
  const goalId = prescription.read === 'ok' ? prescription.value?.goalId ?? null : null
  const [goal, config, plans, orders, drafts, snapshot] = await Promise.all([
    goalId
      ? readMaybe(db.from('goals').select('target_value, baseline_value, current_value, period_start, period_end').eq('id', goalId).eq('client_id', input.clientId))
      : Promise.resolve({ read: 'skipped' as const }),
    readMaybe(db.from('ad_strategy_configs').select('daily_budget_cap_cents, creative_pool, target_cost_per_primary').eq('client_id', input.clientId)),
    readList(db.from('marketing_plans').select('id, status, plan_data, generation_meta, created_at').eq('client_id', input.clientId).order('created_at', { ascending: false })),
    goalId
      ? readList(db.from('content_work_orders').select('status, updated_at').eq('client_id', input.clientId).eq('goal_id', goalId))
      : Promise.resolve({ read: 'skipped' as const }),
    readDrafts(db, input.clientId, input.prescriptionId),
    readMaybe(db.from('ad_entity_snapshots').select('captured_at').eq('client_id', input.clientId).order('captured_at', { ascending: false }).limit(1)),
  ])
  const split = configFrom(config)
  return {
    nowIso: input.nowIso,
    prescriptionId: input.prescriptionId,
    prescription,
    goal: goalFrom(goal),
    outcome: split.outcome,
    strategy: split.strategy,
    plans: plansFrom(plans),
    workOrders: orders.read === 'skipped' ? { read: 'skipped' } : ordersFrom(orders),
    drafts,
    snapshot: snapshotFrom(snapshot),
  }
}

/** The production reader is the service client. Callers must already have passed the access check. */
export function serviceReader(db: SupabaseClient): ChainReader {
  return db as unknown as ChainReader
}
