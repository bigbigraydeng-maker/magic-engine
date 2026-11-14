/**
 * Load add-creative holds for list/detail screens. Display only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { buildAddCreativeDisplay, type AddCreativeCardDetail } from './display'
import { addCreativeOutcomeFromHold } from './outcome'
import type { CreativeHold } from './ledger'

export interface AddCreativeListExtras {
  readonly detail: AddCreativeCardDetail
  readonly statusChip: string | null
  readonly statusLine: string | null
}

function asHold(row: { payload?: unknown }): CreativeHold | null {
  if (!row.payload || typeof row.payload !== 'object') return null
  const payload = row.payload as CreativeHold
  if (payload.kind !== 'add_ad_creative' || !payload.cardRunId || !payload.order) return null
  return payload
}

function extrasFromHold(hold: CreativeHold): AddCreativeListExtras {
  const extra = hold as CreativeHold & { adSetName?: unknown }
  const outcome = addCreativeOutcomeFromHold(hold)
  return {
    detail: buildAddCreativeDisplay(hold.order, extra.adSetName),
    statusChip: outcome?.statusChip ?? null,
    statusLine: outcome?.statusLine ?? null,
  }
}

export async function addCreativeListExtrasByRunId(
  sb: SupabaseClient,
  clientId: string,
): Promise<Map<string, AddCreativeListExtras>> {
  const out = new Map<string, AddCreativeListExtras>()
  try {
    const { data, error } = await sb
      .from('flywheel_actions')
      .select('payload')
      .eq('client_id', clientId)
      .eq('action_type', ADS_ACTION_TYPE.ADD_AD_CREATIVE)
    if (error) return out
    for (const row of data ?? []) {
      const hold = asHold(row as { payload?: unknown })
      if (!hold) continue
      out.set(hold.cardRunId, extrasFromHold(hold))
    }
  } catch {
    return out
  }
  return out
}

export async function addCreativeListExtrasForRun(
  sb: SupabaseClient,
  clientId: string,
  runId: string,
): Promise<AddCreativeListExtras | null> {
  const map = await addCreativeListExtrasByRunId(sb, clientId)
  return map.get(runId) ?? null
}

/** @deprecated Use addCreativeListExtrasByRunId */
export async function addCreativeDetailsByRunId(
  sb: SupabaseClient,
  clientId: string,
): Promise<Map<string, AddCreativeCardDetail>> {
  const map = await addCreativeListExtrasByRunId(sb, clientId)
  return new Map([...map.entries()].map(([id, row]) => [id, row.detail]))
}