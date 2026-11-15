/**
 * Per-client switch. Off unless leads_config.activate_ad_card is exactly true.
 * Missing, false, and any other value stay off. No new column.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const ACTIVATE_AD_SWITCH_KEY = 'activate_ad_card'

export function activateAdCardEnabled(leadsConfig: unknown): boolean {
  const root = objectOf(leadsConfig)
  return root?.[ACTIVATE_AD_SWITCH_KEY] === true
}

export function withActivateAdCardSwitch(leadsConfig: unknown, enabled: boolean): Record<string, unknown> {
  return { ...objectOf(leadsConfig), [ACTIVATE_AD_SWITCH_KEY]: enabled }
}

export async function readActivateSwitch(
  sb: SupabaseClient,
  clientId: string,
): Promise<'on' | 'off' | 'unreadable'> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) return 'unreadable'
  return activateAdCardEnabled((data as { leads_config?: unknown }).leads_config) ? 'on' : 'off'
}

export async function writeActivateSwitch(
  sb: SupabaseClient,
  clientId: string,
  enabled: boolean,
): Promise<'on' | 'off' | 'unreadable'> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) return 'unreadable'
  const next = withActivateAdCardSwitch((data as { leads_config?: unknown }).leads_config, enabled)
  const saved = await sb.from('clients').update({ leads_config: next }).eq('id', clientId)
  return saved.error ? 'unreadable' : (enabled ? 'on' : 'off')
}

export function switchReason(state: 'off' | 'unreadable'): string {
  return state === 'off'
    ? '这个客户没开把暂停广告打开的确认卡。'
    : '这张卡的开关读不到，没有出卡。'
}

function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}
