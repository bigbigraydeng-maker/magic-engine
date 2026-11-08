/**
 * Budget-step rows live in flywheel_actions.
 * expected_metric and expected_delta are the existing columns.
 * The window and the before/after amounts stay in the existing payload.
 * A row left in `writing` is not retried.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { BudgetOrder, MetricDirection } from './types'
import type { PrescriptionLock } from './prescription-lock'

export const BUDGET_ACTION_TYPE = ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET

export type HoldStatus = 'holding' | 'awaiting' | 'writing' | 'executed' | 'failed' | 'declined'

export interface BudgetHold {
  kind: 'adset_daily_budget'
  status: HoldStatus
  cardRunId: string
  subjectKey: string
  fingerprint: string
  orderKey: string
  order: BudgetOrder
  lock: PrescriptionLock
  idempotencyKey: string
  beforeCents: number
  afterCents: number
  direction: MetricDirection
  observationWindowDays: number
  confirmedBy: string | null
  actionRunId: string | null
  readbackCents: number | null
  readbackMatched: boolean | null
  writeAttempted: boolean
  wroteMeta: boolean
  resultLine?: string
}

export interface HoldRow {
  readonly id: string
  readonly payload: BudgetHold
}

export function directionDelta(direction: MetricDirection): number {
  return direction === 'up' ? 1 : -1
}

export async function holdForCard(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, 'payload->>cardRunId', runId)
  return rows.length === 1 ? rows[0] ?? null : null
}

export async function insertHold(
  sb: SupabaseClient,
  clientId: string,
  payload: BudgetHold,
): Promise<void> {
  const existing = await holdForCard(sb, clientId, payload.cardRunId)
  if (existing) return
  const { error } = await sb.from('flywheel_actions').insert(actionRow(clientId, payload))
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有改日预算。')
}

export async function retireStale(
  sb: SupabaseClient,
  clientId: string,
  subjectKey: string,
  fingerprint: string,
): Promise<void> {
  const rows = await rowsWhere(sb, clientId, 'payload->>subjectKey', subjectKey)
  for (const row of rows) {
    if (row.payload.status !== 'holding' || row.payload.fingerprint === fingerprint) continue
    await saveHold(sb, clientId, row, {
      ...row.payload,
      status: 'failed',
      writeAttempted: false,
      wroteMeta: false,
      resultLine: '内容变了，这张旧卡不能用来改日预算。',
    })
  }
}

export async function claimWrite(
  sb: SupabaseClient,
  clientId: string,
  row: HoldRow,
  confirmedBy: string,
): Promise<boolean> {
  const next: BudgetHold = { ...row.payload, status: 'writing', confirmedBy, writeAttempted: true }
  const { data, error } = await sb.from('flywheel_actions')
    .update({ payload: next })
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('payload->>status', 'holding')
    .select('id')
    .maybeSingle()
  return !error && Boolean((data as { id?: string } | null)?.id)
}

export async function saveHold(
  sb: SupabaseClient,
  clientId: string,
  row: HoldRow,
  payload: BudgetHold,
): Promise<void> {
  const { error } = await sb.from('flywheel_actions')
    .update({
      payload,
      expected_metric: payload.order.expectedMetric,
      expected_delta: directionDelta(payload.direction),
    })
    .eq('id', row.id)
    .eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再改一次日预算。')
}

function actionRow(clientId: string, payload: BudgetHold) {
  return {
    client_id: clientId,
    flywheel: 'ads',
    action_type: BUDGET_ACTION_TYPE,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
    expected_metric: payload.order.expectedMetric,
    expected_delta: directionDelta(payload.direction),
  }
}

async function rowsWhere(
  sb: SupabaseClient,
  clientId: string,
  column: string,
  value: string,
): Promise<HoldRow[]> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', BUDGET_ACTION_TYPE)
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '改日预算的台账读不出来，没有改。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as BudgetHold
  if (payload.kind !== 'adset_daily_budget' || !payload.cardRunId || !payload.order || !payload.lock) return []
  return [{ id: row.id, payload }]
}
