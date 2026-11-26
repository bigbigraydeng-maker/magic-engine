/**
 * Per-client switch. Off unless leads_config.pause_ad_set_card is exactly true.
 * Missing, false, and any other value stay off. No new column.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const PAUSE_CARD_SWITCH_KEY = 'pause_ad_set_card'

export function pauseCardEnabled(leadsConfig: unknown): boolean {
  const root = objectOf(leadsConfig)
  return root?.[PAUSE_CARD_SWITCH_KEY] === true
}

export function withPauseCardSwitch(leadsConfig: unknown, enabled: boolean): Record<string, unknown> {
  return { ...objectOf(leadsConfig), [PAUSE_CARD_SWITCH_KEY]: enabled }
}

export async function readPauseCardSwitch(
  sb: SupabaseClient,
  clientId: string,
): Promise<'on' | 'off' | 'unreadable'> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) return 'unreadable'
  return pauseCardEnabled((data as { leads_config?: unknown }).leads_config) ? 'on' : 'off'
}

export async function writePauseCardSwitch(
  sb: SupabaseClient,
  clientId: string,
  enabled: boolean,
): Promise<'on' | 'off' | 'unreadable'> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) return 'unreadable'
  const next = withPauseCardSwitch((data as { leads_config?: unknown }).leads_config, enabled)
  const saved = await sb.from('clients').update({ leads_config: next }).eq('id', clientId)
  return saved.error ? 'unreadable' : (enabled ? 'on' : 'off')
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}
