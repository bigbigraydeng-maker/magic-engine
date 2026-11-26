/**
 * Per-client gate for ads investigation tools in project Luban (read-only).
 * Flag lives in `clients.leads_config.ads_agent_investigation_tools` — no migration.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export function parseAdsAgentInvestigationEnabled(leadsConfig: unknown): boolean {
  if (!leadsConfig || typeof leadsConfig !== 'object' || Array.isArray(leadsConfig)) return false
  return (leadsConfig as { ads_agent_investigation_tools?: unknown }).ads_agent_investigation_tools === true
}

export async function loadAdsAgentInvestigationEnabled(
  supabase: SupabaseClient,
  clientId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()
  if (error) {
    console.warn('[ads-agent-chat] leads_config read failed:', error.message)
    return false
  }
  return parseAdsAgentInvestigationEnabled((data as { leads_config?: unknown } | null)?.leads_config)
}
