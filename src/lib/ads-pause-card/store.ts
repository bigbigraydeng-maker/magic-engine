/**
 * Pause-card ledger rows live in flywheel_actions.
 * expected_metric is written only after readback matches. A hold is not an outcome.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { PauseOrder } from './order'

export const EMPTY_ACK_ACTION = 'ads.pause_empty_ack'

export type HoldStatus = 'holding' | 'pausing' | 'executed' | 'failed' | 'refused' | 'declined' | 'confirmed'

export interface HoldStep {
  readonly key: string
  readonly status: string
}

export interface PauseHoldPayload {
  role: 'pause' | 'empty_ack'
  status: HoldStatus
  cardRunId: string
  subjectKey: string
  fingerprint: string
  orderKey: string
  order: PauseOrder
  steps: HoldStep[]
  pauseAttempted: boolean
  resultLine?: string
  readback?: string | null
  wroteMeta?: boolean
}

export interface HoldRow {
  readonly id: string
  readonly payload: PauseHoldPayload
}

export function pauseActionType(order: PauseOrder): string {
  return order.level === 'ad' ? ADS_ACTION_TYPE.PAUSE_AD : ADS_ACTION_TYPE.PAUSE_AD_SET
}

export async function holdForCard(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, 'payload->>cardRunId', runId)
  return rows.length === 1 ? rows[0] ?? null : null
}

export async function ackIsConfirmed(sb: SupabaseClient, clientId: string, orderKey: string): Promise<boolean> {
  const rows = await rowsWhere(sb, clientId, 'payload->>orderKey', orderKey)
  return rows.some((row) => row.payload.role === 'empty_ack' && row.payload.status === 'confirmed')
}

export async function retireStalePause(sb: SupabaseClient, clientId: string, orderKey: string, fingerprint: string): Promise<void> {
  const rows = await rowsWhere(sb, clientId, 'payload->>orderKey', orderKey)
  for (const row of rows) {
    if (row.payload.role !== 'pause' || row.payload.status !== 'holding') continue
    if (row.payload.fingerprint === fingerprint) continue
    await saveHold(sb, clientId, row, {
      ...row.payload,
      status: 'refused',
      wroteMeta: false,
      resultLine: '内容变了，这张旧卡不能用来暂停。',
    }, null)
  }
}

export async function insertHold(
  sb: SupabaseClient,
  clientId: string,
  actionType: string,
  payload: PauseHoldPayload,
): Promise<void> {
  const existing = await holdForCard(sb, clientId, payload.cardRunId)
  if (existing) return
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'ads',
    action_type: actionType,
    execution_mode: payload.role === 'pause' ? 'third_party' : 'in_house',
    vendor: payload.role === 'pause' ? 'meta' : null,
    payload,
    expected_metric: null,
  })
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有去暂停。')
}

export async function claimPause(sb: SupabaseClient, clientId: string, row: HoldRow): Promise<boolean> {
  const next = { ...row.payload, status: 'pausing' as const, pauseAttempted: true }
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
  payload: PauseHoldPayload,
  expectedMetric: string | null,
): Promise<void> {
  const { error } = await sb.from('flywheel_actions')
    .update({ payload, expected_metric: expectedMetric })
    .eq('id', row.id)
    .eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再去暂停一次。')
}

async function rowsWhere(sb: SupabaseClient, clientId: string, column: string, value: string): Promise<HoldRow[]> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('id, action_type, payload')
    .eq('client_id', clientId)
    .in('action_type', [ADS_ACTION_TYPE.PAUSE_AD, ADS_ACTION_TYPE.PAUSE_AD_SET, EMPTY_ACK_ACTION])
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '暂停卡的台账读不出来，没有去暂停。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as PauseHoldPayload
  if (!payload.cardRunId || !payload.orderKey || !payload.order) return []
  return [{ id: row.id, payload }]
}
