/**
 * Pause-card rows live in flywheel_actions.
 * A row left in `writing` is never submitted again.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { ApprovalSource } from '@/lib/approval-source/read'
import type { PauseAdSetOrder } from './order'

export type HoldStatus = 'holding' | 'writing' | 'executed' | 'failed' | 'declined' | 'refused'

export interface PauseHold {
  status: HoldStatus
  cardRunId: string
  fingerprint: string
  orderKey: string
  order: PauseAdSetOrder
  goalId: string
  planId: string
  source: ApprovalSource | null
  before: string | null
  after: string | null
  wrote: boolean
  resultLine?: string
  kernelRunId?: string | null
}

export interface HoldRow {
  readonly id: string
  readonly payload: PauseHold
}

const ACTION = ADS_ACTION_TYPE.PAUSE_AD_SET

export async function holdForCard(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, 'payload->>cardRunId', runId)
  return rows.length === 1 ? rows[0] ?? null : null
}

export async function retireStale(sb: SupabaseClient, clientId: string, orderKey: string, fingerprint: string): Promise<void> {
  const rows = await rowsWhere(sb, clientId, 'payload->>orderKey', orderKey)
  for (const row of rows) {
    if (row.payload.status !== 'holding' || row.payload.fingerprint === fingerprint) continue
    await saveHold(sb, clientId, row, {
      ...row.payload,
      status: 'refused',
      wrote: false,
      resultLine: '内容变了，这张旧卡不能用来暂停。',
    }, null)
  }
}

export async function insertHold(sb: SupabaseClient, clientId: string, payload: PauseHold): Promise<void> {
  if (await holdForCard(sb, clientId, payload.cardRunId)) return
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'ads',
    action_type: ACTION,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
    expected_metric: null,
  })
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有去暂停。')
}

export async function claimWriting(sb: SupabaseClient, clientId: string, row: HoldRow): Promise<boolean> {
  const next = { ...row.payload, status: 'writing' as const, wrote: false }
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
  payload: PauseHold,
  expectedMetric: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { payload, expected_metric: expectedMetric }
  if (payload.status === 'executed') patch.executed_at = new Date().toISOString()
  if (payload.kernelRunId) patch.action_run_id = payload.kernelRunId
  const { error } = await sb.from('flywheel_actions').update(patch).eq('id', row.id).eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再去暂停一次。')
}

async function rowsWhere(sb: SupabaseClient, clientId: string, column: string, value: string): Promise<HoldRow[]> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', ACTION)
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '暂停卡的台账读不出来，没有去暂停。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as PauseHold
  if (payload.status === 'writing' || payload.order?.direction === 'pause') {
    if (!payload.cardRunId || !payload.orderKey || !payload.order) return []
    return [{ id: row.id, payload }]
  }
  return []
}
