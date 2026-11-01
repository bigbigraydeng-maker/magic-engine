/**
 * Per-client switch for pause cards.
 * Uses the existing client_automation_policies row. No new table or column.
 * Missing row, deny, and auto_approve are all off: this card always needs a person.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getActivePolicy } from '@/lib/kernel/store'
import type { PolicyMode } from '@/lib/kernel/types'

export const PAUSE_CARD_POLICY_KEY = 'ads.pause_object_card'
const TTL_SECONDS = 30 * 60

export function pauseCardSwitch(mode: PolicyMode | null): 'on' | 'off' {
  return mode === 'require_approval' ? 'on' : 'off'
}

export async function readPauseCardSwitch(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<'on' | 'off' | 'unreadable'> {
  try {
    const policy = await getActivePolicy(sb, clientId, PAUSE_CARD_POLICY_KEY, now)
    return pauseCardSwitch(policy?.mode ?? null)
  } catch {
    return 'unreadable'
  }
}

/** Staff path. Never writes auto_approve. */
export async function setPauseCardSwitch(
  sb: SupabaseClient,
  clientId: string,
  enabled: boolean,
  updatedBy: string,
  now: Date,
): Promise<'on' | 'off' | 'unreadable'> {
  const mode: PolicyMode = enabled ? 'require_approval' : 'deny'
  try {
    const existing = await getActivePolicy(sb, clientId, PAUSE_CARD_POLICY_KEY, now)
    if (!existing) return (await insertSwitch(sb, clientId, mode, updatedBy, now)) ? pauseCardSwitch(mode) : 'unreadable'
    if (existing.mode === mode) return pauseCardSwitch(mode)
    const { error } = await sb.from('client_automation_policies').update({
      mode,
      updated_by: updatedBy,
    }).eq('id', existing.id)
    return error ? 'unreadable' : pauseCardSwitch(mode)
  } catch {
    return 'unreadable'
  }
}

async function insertSwitch(
  sb: SupabaseClient,
  clientId: string,
  mode: PolicyMode,
  updatedBy: string,
  now: Date,
): Promise<boolean> {
  const { error } = await sb.from('client_automation_policies').insert({
    client_id: clientId,
    action_key: PAUSE_CARD_POLICY_KEY,
    mode,
    policy_version: 1,
    spend_cap_per_run_usd: 0,
    decision_ttl_seconds: TTL_SECONDS,
    effective_from: now.toISOString(),
    effective_to: null,
    updated_by: updatedBy,
  })
  return !error
}
