/**
 * Per-client Tune switch. Off unless leads_config.ads_tune_cards is exactly true.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { tuneCardsEnabled, withTuneSwitch } from './plan'

export async function readTuneSwitch(
  sb: SupabaseClient,
  clientId: string,
): Promise<'on' | 'off' | 'unreadable'> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) return 'unreadable'
  return tuneCardsEnabled((data as { leads_config?: unknown }).leads_config) ? 'on' : 'off'
}

export async function writeTuneSwitch(
  sb: SupabaseClient,
  clientId: string,
  enabled: boolean,
): Promise<'on' | 'off' | 'unreadable'> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) return 'unreadable'
  const next = withTuneSwitch((data as { leads_config?: unknown }).leads_config, enabled)
  const saved = await sb.from('clients').update({ leads_config: next }).eq('id', clientId)
  return saved.error ? 'unreadable' : (enabled ? 'on' : 'off')
}
