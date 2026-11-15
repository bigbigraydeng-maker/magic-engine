/**
 * Activate-ad rows live in flywheel_actions.
 * A row left in `writing` is not submitted again.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'

export type HoldStatus = 'holding' | 'writing' | 'executed' | 'failed' | 'declined'

export interface ActivateHold {
  kind: 'activate_ad'
  status: HoldStatus
  cardRunId: string
  subjectKey: string
  fingerprint: string
  adId: string
  adName: string
  adsetName: string
  adsetId: string | null
  campaignId: string | null
  adAccountId: string | null
  previewUrl: string | null
  planId: string | null
  wrote: boolean
  issuedAt: string
  resultLine?: string
  readback?: string | null
}

export interface HoldRow {
  readonly id: string
  readonly payload: ActivateHold
}

const ACTION = ADS_ACTION_TYPE.ACTIVATE_AD

export async function holdForCard(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, 'payload->>cardRunId', runId)
  return rows.length === 1 ? rows[0] ?? null : null
}

export async function insertHold(sb: SupabaseClient, clientId: string, payload: ActivateHold): Promise<void> {
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
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有去改。')
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
      wrote: false,
      resultLine: '内容变了，这张旧卡不能用来打开广告。',
    })
  }
}

export async function claimWriting(sb: SupabaseClient, clientId: string, row: HoldRow): Promise<boolean> {
  const next: ActivateHold = { ...row.payload, status: 'writing', wrote: false }
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
  payload: ActivateHold,
): Promise<void> {
  const patch: Record<string, unknown> = { payload }
  if (payload.status === 'executed') patch.executed_at = new Date().toISOString()
  const { error } = await sb.from('flywheel_actions').update(patch).eq('id', row.id).eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再去改一次。')
}

async function rowsWhere(sb: SupabaseClient, clientId: string, column: string, value: string): Promise<HoldRow[]> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', ACTION)
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '这张开卡的台账读不出来，没有去改。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as ActivateHold
  if (payload.kind !== 'activate_ad' || !payload.cardRunId || !payload.adId) return []
  return [{ id: row.id, payload }]
}
