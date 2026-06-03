/**
 * P31.X.2 — Goal primary metric auto-fetch
 *
 * Resolves a current_value for Goals whose primary_metric_key has
 * measurement='auto', by reading from already-cached ME data sources.
 *
 * Supported metric keys (MVP):
 *   - organic_traffic    → ga4_traffic_snapshots.total_sessions (latest)
 *   - brand_search_volume→ keyword_snapshots (brand keyword, latest volume)
 *
 * Not yet supported (data source missing or complex):
 *   - form_submissions   → GA4 key_events (not stored in snapshot)
 *   - ai_visibility_score→ ai_visibility_snapshots (no 0-100 column yet)
 *   - conversion_rate    → derived GA4 (events/sessions)
 *   - social_followers_growth → no data source
 *   - cart_abandonment_rate → no data source
 *
 * Returns null when unsupported or no data found.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type AutoFetchResult =
  | { ok: true;  value: number; source: string; snapshot_date: string; label: string }
  | { ok: false; reason: string }

/**
 * Attempt to auto-fetch a current value for the given metric key.
 *
 * @param supabase  Admin client
 * @param clientId  Client UUID
 * @param metricKey e.g. 'organic_traffic'
 */
export async function autoFetchMetricValue(
  supabase: SupabaseClient,
  clientId: string,
  metricKey: string,
): Promise<AutoFetchResult> {
  switch (metricKey) {
    case 'organic_traffic':
      return fetchOrganicTraffic(supabase, clientId)
    case 'brand_search_volume':
      return fetchBrandSearchVolume(supabase, clientId)
    default:
      return { ok: false, reason: `metric '${metricKey}' does not have an auto-fetch source yet` }
  }
}

// ── organic_traffic ────────────────────────────────────────────────────────

async function fetchOrganicTraffic(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  const { data, error } = await supabase
    .from('ga4_traffic_snapshots')
    .select('total_sessions, period_start, period_end')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: `GA4 query failed: ${error.message}` }
  }
  if (!data) {
    return { ok: false, reason: 'No GA4 snapshot found — run GA4 Sync first' }
  }
  if (typeof data.total_sessions !== 'number') {
    return { ok: false, reason: 'GA4 snapshot missing total_sessions value' }
  }

  return {
    ok: true,
    value: data.total_sessions,
    source: 'GA4 (28-day sessions)',
    snapshot_date: data.period_end as string,
    label: `${data.total_sessions.toLocaleString()} sessions (${formatDate(data.period_start as string)} → ${formatDate(data.period_end as string)})`,
  }
}

// ── brand_search_volume ────────────────────────────────────────────────────

async function fetchBrandSearchVolume(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  // First get the client's primary keyword / brand name
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('primary_keyword, name')
    .eq('id', clientId)
    .maybeSingle()

  if (clientErr) {
    return { ok: false, reason: `Client query failed: ${clientErr.message}` }
  }
  if (!client) {
    return { ok: false, reason: 'Client not found' }
  }

  const brandKeyword = client.primary_keyword ?? client.name
  if (!brandKeyword) {
    return { ok: false, reason: 'Client has no primary_keyword — cannot look up brand search volume' }
  }

  // Look up the most recent keyword snapshot for this brand keyword
  const { data: snap, error: snapErr } = await supabase
    .from('keyword_snapshots')
    .select('search_volume, snapped_at, keyword')
    .eq('client_id', clientId)
    .ilike('keyword', brandKeyword)
    .order('snapped_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (snapErr) {
    return { ok: false, reason: `keyword_snapshots query failed: ${snapErr.message}` }
  }
  if (!snap) {
    return {
      ok: false,
      reason: `No keyword snapshot found for "${brandKeyword}" — run SEO Intelligence sync first`,
    }
  }
  if (snap.search_volume == null) {
    return { ok: false, reason: `Keyword snapshot for "${brandKeyword}" has no search_volume` }
  }

  return {
    ok: true,
    value: snap.search_volume as number,
    source: 'SEMrush keyword snapshot',
    snapshot_date: snap.snapped_at as string,
    label: `${(snap.search_volume as number).toLocaleString()} searches/mo for "${snap.keyword as string}"`,
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}
