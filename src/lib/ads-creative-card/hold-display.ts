/**
 * Load add-creative holds for list/detail screens. Display only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { buildAddCreativeDisplay, type AddCreativeCardDetail } from './display'
import type { CreativeHold } from './ledger'

function asHold(row: { payload?: unknown }): CreativeHold | null {
  if (!row.payload || typeof row.payload !== 'object') return null
  const payload = row.payload as CreativeHold
  if (payload.kind !== 'add_ad_creative' || !payload.cardRunId || !payload.order) return null
  return payload
}

export async function addCreativeDetailsByRunId(
  sb: SupabaseClient,
  clientId: string,
): Promise<Map<string, AddCreativeCardDetail>> {
  const out = new Map<string, AddCreativeCardDetail>()
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
      const extra = hold as CreativeHold & { adSetName?: unknown }
      out.set(hold.cardRunId, buildAddCreativeDisplay(hold.order, extra.adSetName))
    }
  } catch {
    return out
  }
  return out
}

export async function addCreativeResultLines(
  sb: SupabaseClient,
  clientId: string,
): Promise<Map<string, string>> {
  const lines = new Map<string, string>()
  try {
    const { data, error } = await sb
      .from('flywheel_actions')
      .select('payload')
      .eq('client_id', clientId)
      .eq('action_type', ADS_ACTION_TYPE.ADD_AD_CREATIVE)
    if (error) return lines
    for (const row of data ?? []) {
      const hold = asHold(row as { payload?: unknown })
      if (!hold?.resultLine) continue
      lines.set(hold.cardRunId, hold.resultLine)
    }
  } catch {
    return lines
  }
  return lines
}