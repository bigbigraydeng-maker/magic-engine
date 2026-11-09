import { findSharedAdAccounts, getActiveClientsWithMetaAccounts } from '@/lib/meta/client-ad-accounts'
import { fetchHeartbeatAdsets, fetchHeartbeatTodayInsights, type GraphReadError } from '@/lib/meta/entity-settings'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { supabaseAdmin } from '@/lib/supabase'
import { readClientDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { loadRecentSamples, purgeSamplesBefore, upsertSamples } from './db'
import type { SampleDeps } from './run'
import { isGraphRateLimited } from './sample'

/** Production wiring. Reads Meta only through the existing heartbeat GETs. */
export function productionDeps(): SampleDeps {
  return {
    listClients: () => getActiveClientsWithMetaAccounts(supabaseAdmin),
    listAccounts: listAccounts,
    sharedBareIds: async (clientId, ids) => (await findSharedAdAccounts(clientId, ids)).shared,
    accountContext,
    token: getMetaTokenForClient,
    readAccount,
    upsert: (rows) => upsertSamples(supabaseAdmin, rows),
    purge: (before) => purgeSamplesBefore(supabaseAdmin, before),
    loadSamples: async (clientId, since) => (await loadRecentSamples(supabaseAdmin, clientId, since)) ?? [],
    capMinor: async (clientId) => {
      const cap = await readClientDailyTotalCap(supabaseAdmin, clientId)
      return cap.state === 'set' ? cap.cents : null
    },
  }
}
async function listAccounts(clientId: string): Promise<{ adAccountId: string; hidden: boolean }[]> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id, hidden_from_ad_health')
    .eq('client_id', clientId)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { ad_account_id: string; hidden_from_ad_health: boolean | null }[]
  if (rows.length > 0) {
    return rows.map((row) => ({ adAccountId: actId(row.ad_account_id), hidden: row.hidden_from_ad_health === true }))
  }
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()
  if (clientError) throw new Error(clientError.message)
  const primary = (client as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id
  return primary ? [{ adAccountId: actId(primary), hidden: false }] : []
}
async function accountContext(adAccountId: string): Promise<{ timezone: string | null; currency: string | null }> {
  for (const id of [adAccountId.replace(/^act_/i, ''), adAccountId]) {
    const { data, error } = await supabaseAdmin
      .from('ad_entity_snapshots')
      .select('timezone_name, currency')
      .eq('ad_account_id', id)
      .eq('level', 'account')
      .order('captured_at', { ascending: false })
      .limit(1)
    if (error) return { timezone: null, currency: null }
    const row = (data ?? [])[0] as { timezone_name?: string | null; currency?: string | null } | undefined
    if (row?.timezone_name) return { timezone: row.timezone_name, currency: row.currency ?? null }
  }
  return { timezone: null, currency: null }
}
async function readAccount(adAccountId: string, token: string, day: string) {
  const adsets = await fetchHeartbeatAdsets(adAccountId, token)
  const mapped = adsets.rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id ?? null,
    status: row.effective_status ?? null,
  }))
  if (limited(adsets.error) || !adsets.complete) {
    return { complete: false, rateLimited: limited(adsets.error), adsets: mapped, insights: [] }
  }
  if (!mapped.some((row) => row.status === 'ACTIVE')) {
    return { complete: true, rateLimited: false, adsets: mapped, insights: [] }
  }
  const insights = await fetchHeartbeatTodayInsights(adAccountId, token, day)
  return {
    complete: insights.complete && !limited(insights.error),
    rateLimited: limited(insights.error),
    adsets: mapped,
    insights: insights.rows.map((row) => ({ adsetId: row.adset_id ?? '', spend: row.spend, impressions: row.impressions })),
  }
}
function limited(error: GraphReadError | null): boolean {
  return isGraphRateLimited(error ? { status: error.status, code: error.code } : null)
}
function actId(raw: string): string {
  return `act_${raw.replace(/^act_/i, '').trim()}`
}
