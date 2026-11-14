/**
 * Non-blocking persistence for ads_decision_v1 on flywheel_actions.
 * Card ledger rows are append-only from this module: a decision is a new row,
 * and a later review replaces only ads_decision_v1 on the latest payload.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import type { AdsDecisionV1 } from './types'
import { ADS_DECISION_SCHEMA_VERSION } from './types'

export function readAdsDecisionV1(payload: unknown): AdsDecisionV1 | null {
  const root = objectOf(payload)
  const block = objectOf(root?.ads_decision_v1)
  if (block?.schema_version !== ADS_DECISION_SCHEMA_VERSION) return null
  return block as unknown as AdsDecisionV1
}

export async function mergeDecisionOntoCardRow(
  supabase: SupabaseClient,
  input: {
    clientId: string
    actionId: string
    decision: AdsDecisionV1
    currentPayload: Record<string, unknown> | null
  },
): Promise<void> {
  if (readAdsDecisionV1(input.currentPayload)) return
  const linked = await linkedDecisionExists(supabase, input.clientId, input.actionId)
  if (linked !== false) return
  const decision = input.decision.linked_card_action_id
    ? input.decision
    : { ...input.decision, linked_card_action_id: input.actionId }
  await insertDecisionLogRow(supabase, input.clientId, decision)
}

export async function insertDecisionLogRow(
  supabase: SupabaseClient,
  clientId: string,
  decision: AdsDecisionV1,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .insert({
      client_id: clientId,
      flywheel: 'ads',
      action_type: ADS_ACTION_TYPE.DECISION_LOG,
      execution_mode: 'external_manual',
      vendor: 'meta',
      payload: { ads_decision_v1: decision },
      expected_metric: null,
      executed_at: decision.status === 'active' ? decision.decided_at : null,
    })
    .select('id')
    .maybeSingle()
  if (error) {
    console.warn('[ads-decision-log] insert decision row failed:', error.message)
    return null
  }
  return typeof data?.id === 'string' ? data.id : null
}

export async function patchDecisionOnRow(
  supabase: SupabaseClient,
  input: {
    clientId: string
    actionId: string
    decision: AdsDecisionV1
    currentPayload?: Record<string, unknown> | null
  },
): Promise<boolean> {
  const latest = await latestPayload(supabase, input.clientId, input.actionId)
  if (!latest) {
    console.warn('[ads-decision-log] patch skipped; latest ledger row unread')
    return false
  }
  const payload = { ...latest, ads_decision_v1: input.decision }
  const { error } = await supabase
    .from('flywheel_actions')
    .update({ payload })
    .eq('id', input.actionId)
    .eq('client_id', input.clientId)
  if (error) {
    console.warn('[ads-decision-log] patch decision failed:', error.message)
    return false
  }
  return true
}

async function linkedDecisionExists(
  supabase: SupabaseClient,
  clientId: string,
  cardActionId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id')
    .eq('client_id', clientId)
    .eq('flywheel', 'ads')
    .eq('action_type', ADS_ACTION_TYPE.DECISION_LOG)
    .eq('payload->ads_decision_v1->>linked_card_action_id', cardActionId)
    .limit(1)
  if (error || !Array.isArray(data)) {
    if (error) console.warn('[ads-decision-log] linked decision lookup failed:', error.message)
    return null
  }
  return data.length > 0
}

async function latestPayload(
  supabase: SupabaseClient,
  clientId: string,
  actionId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('payload')
    .eq('id', actionId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const payload = (data as { payload?: unknown }).payload
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>) }
    : null
}

export function nzBusinessDateFromIso(iso: string, addDays: number): string {
  const base = Date.parse(iso)
  if (!Number.isFinite(base)) return iso.slice(0, 10)
  const shifted = new Date(base + addDays * 86_400_000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}
