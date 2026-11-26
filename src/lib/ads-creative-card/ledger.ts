/**
 * Add-creative rows live in flywheel_actions.
 * A row left in `writing` is not submitted again.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { CopiedStory, CreativeOrder } from './order'

export type HoldStatus = 'holding' | 'writing' | 'executed' | 'failed' | 'declined'

export interface CreativeHold {
  kind: 'add_ad_creative'
  status: HoldStatus
  cardRunId: string
  subjectKey: string
  fingerprint: string
  orderKey: string
  order: CreativeOrder
  copy: CopiedStory
  planId: string
  imageHash: string | null
  creativeId: string | null
  adId: string | null
  wrote: boolean
  resultLine?: string
}

export interface HoldRow {
  readonly id: string
  readonly payload: CreativeHold
}

const ACTION = ADS_ACTION_TYPE.ADD_AD_CREATIVE

export async function holdForCard(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, 'payload->>cardRunId', runId)
  return rows.length === 1 ? rows[0] ?? null : null
}

export async function insertHold(sb: SupabaseClient, clientId: string, payload: CreativeHold): Promise<void> {
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
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有去建。')
}

export async function retireStale(sb: SupabaseClient, clientId: string, subjectKey: string, fingerprint: string): Promise<void> {
  const rows = await rowsWhere(sb, clientId, 'payload->>subjectKey', subjectKey)
  for (const row of rows) {
    if (row.payload.status !== 'holding' || row.payload.fingerprint === fingerprint) continue
    await saveHold(sb, clientId, row, {
      ...row.payload,
      status: 'failed',
      wrote: false,
      resultLine: '内容变了，这张旧卡不能用来加图。',
    })
  }
}

export async function claimWriting(sb: SupabaseClient, clientId: string, row: HoldRow): Promise<boolean> {
  const next: CreativeHold = { ...row.payload, status: 'writing', wrote: false }
  const { data, error } = await sb.from('flywheel_actions')
    .update({ payload: next })
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('payload->>status', 'holding')
    .select('id')
    .maybeSingle()
  return !error && Boolean((data as { id?: string } | null)?.id)
}

export async function saveHold(sb: SupabaseClient, clientId: string, row: HoldRow, payload: CreativeHold): Promise<void> {
  const patch: Record<string, unknown> = { payload }
  if (payload.status === 'executed') patch.executed_at = new Date().toISOString()
  const { error } = await sb.from('flywheel_actions').update(patch).eq('id', row.id).eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再去建一次。')
}

async function rowsWhere(sb: SupabaseClient, clientId: string, column: string, value: string): Promise<HoldRow[]> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', ACTION)
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '加图卡的台账读不出来，没有去建。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as CreativeHold
  if (payload.kind !== 'add_ad_creative' || !payload.cardRunId || !payload.order) return []
  return [{ id: row.id, payload }]
}
