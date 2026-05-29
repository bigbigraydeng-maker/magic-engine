/**
 * GET /api/cron/google-data-pullback-daily
 *
 * Daily cron — pulls GSC + GA4 + Meta Ads snapshots for every client.
 * Upserts into gsc_performance_snapshots, ga4_traffic_snapshots, and
 * inserts into meta_ads_snapshots.
 *
 * Schedule: daily at 3am UTC (~3pm NZST)
 * Auth: Bearer ${CRON_SECRET}
 * Max duration: 15 min (Render standard plan)
 *
 * Per-client logic:
 *   - GSC: requires anchor='gsc', status='connected', config.site_url
 *   - GA4: requires anchor='ga4', status='connected', config.property_id
 *   - Meta Ads: requires clients.meta_ad_account_id + META_SYSTEM_USER_TOKEN env
 *
 * Reference: ROADMAP.md P17.A.4, P17.B.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGscSnapshot } from '@/lib/gsc/client'
import { fetchGa4Snapshot } from '@/lib/ga4/client'
import { getAdAccountInsights, getAdCampaignInsights } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectorRow {
  client_id: string
  anchor:    'gsc' | 'ga4'
  config:    Record<string, unknown> | null
}

interface ClientWork {
  client_id:          string
  site_url?:          string
  property_id?:       string
  meta_ad_account_id?: string
}

interface ClientResult {
  client_id: string
  gsc?:  { success: boolean; snapshot_id?: string; error?: string }
  ga4?:  { success: boolean; snapshot_id?: string; error?: string }
  meta?: { success: boolean; snapshot_id?: string; error?: string }
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 1. Load connected Google connectors + Meta Ads accounts in parallel ───
  const [connResult, metaResult] = await Promise.all([
    supabaseAdmin
      .from('client_connectors')
      .select('client_id, anchor, config')
      .in('anchor', ['gsc', 'ga4'])
      .eq('status', 'connected'),
    supabaseAdmin
      .from('clients')
      .select('id, meta_ad_account_id')
      .not('meta_ad_account_id', 'is', null),
  ])

  if (connResult.error) {
    return NextResponse.json(
      { error: `Failed to load connectors: ${connResult.error.message}` },
      { status: 500 },
    )
  }

  const connectors = connResult.data
  const metaClients = (metaResult.data ?? []) as Array<{ id: string; meta_ad_account_id: string }>

  // ── 2. Build per-client work map ───────────────────────────────────────────
  const workMap = new Map<string, ClientWork>()

  for (const row of (connectors ?? []) as ConnectorRow[]) {
    const entry = workMap.get(row.client_id) ?? { client_id: row.client_id }

    if (row.anchor === 'gsc') {
      const siteUrl = row.config?.site_url
      if (typeof siteUrl === 'string' && siteUrl.trim()) {
        entry.site_url = siteUrl.trim()
      }
    } else if (row.anchor === 'ga4') {
      const propertyId = row.config?.property_id
      if (typeof propertyId === 'string' && propertyId.trim()) {
        entry.property_id = propertyId.trim()
      }
    }

    workMap.set(row.client_id, entry)
  }

  // Merge Meta Ads clients into work map
  for (const c of metaClients) {
    const entry = workMap.get(c.id) ?? { client_id: c.id }
    entry.meta_ad_account_id = c.meta_ad_account_id
    workMap.set(c.id, entry)
  }

  const work = Array.from(workMap.values()).filter(
    w => w.site_url !== undefined || w.property_id !== undefined || w.meta_ad_account_id !== undefined,
  )

  if (work.length === 0) {
    return NextResponse.json({
      success:           true,
      message:           'No clients with connected data sources — nothing to sync',
      clients_processed: 0,
      gsc_synced:        0,
      ga4_synced:        0,
      meta_synced:       0,
      failed:            0,
      results:           [],
    })
  }

  const metaToken = process.env.META_SYSTEM_USER_TOKEN

  // ── 3. Process each client ─────────────────────────────────────────────────
  const results: ClientResult[] = []

  for (const client of work) {
    const result: ClientResult = { client_id: client.client_id }

    if (client.site_url) {
      result.gsc = await syncGsc(client.client_id, client.site_url)
    }

    if (client.property_id) {
      result.ga4 = await syncGa4(client.client_id, client.property_id)
    }

    if (client.meta_ad_account_id && metaToken) {
      result.meta = await syncMeta(client.client_id, client.meta_ad_account_id, metaToken)
    }

    results.push(result)
  }

  // ── 4. Tally results ───────────────────────────────────────────────────────
  const gscSynced  = results.filter(r => r.gsc?.success).length
  const ga4Synced  = results.filter(r => r.ga4?.success).length
  const metaSynced = results.filter(r => r.meta?.success).length
  const failed     = results.filter(
    r => r.gsc?.success === false || r.ga4?.success === false || r.meta?.success === false,
  ).length

  return NextResponse.json({
    success:           true,
    clients_processed: results.length,
    gsc_synced:        gscSynced,
    ga4_synced:        ga4Synced,
    meta_synced:       metaSynced,
    failed,
    results,
  })
}

// ─── Per-client sync helpers ──────────────────────────────────────────────────

async function syncGsc(
  clientId: string,
  siteUrl: string,
): Promise<{ success: boolean; snapshot_id?: string; error?: string }> {
  try {
    const snapshot = await fetchGscSnapshot(siteUrl, clientId)
    if (!snapshot) {
      return { success: false, error: 'fetchGscSnapshot returned null — check OAuth token and site_url' }
    }

    const { data, error } = await supabaseAdmin
      .from('gsc_performance_snapshots')
      .upsert(
        {
          client_id:         clientId,
          site_url:          snapshot.site_url,
          period_start:      snapshot.period_start,
          period_end:        snapshot.period_end,
          total_clicks:      snapshot.total_clicks,
          total_impressions: snapshot.total_impressions,
          avg_ctr:           snapshot.avg_ctr,
          avg_position:      snapshot.avg_position,
          top_queries:       snapshot.top_queries,
          top_pages:         snapshot.top_pages,
          synced_at:         snapshot.synced_at,
        },
        { onConflict: 'client_id,period_start,period_end' },
      )
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, snapshot_id: (data as { id: string }).id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

async function syncGa4(
  clientId: string,
  propertyId: string,
): Promise<{ success: boolean; snapshot_id?: string; error?: string }> {
  try {
    const snapshot = await fetchGa4Snapshot(propertyId, clientId)
    if (!snapshot) {
      return { success: false, error: 'fetchGa4Snapshot returned null — check OAuth token and property_id' }
    }

    const { data, error } = await supabaseAdmin
      .from('ga4_traffic_snapshots')
      .upsert(
        {
          client_id:            clientId,
          property_id:          snapshot.property_id,
          period_start:         snapshot.period_start,
          period_end:           snapshot.period_end,
          total_sessions:       snapshot.total_sessions,
          total_users:          snapshot.total_users,
          total_new_users:      snapshot.total_new_users,
          total_pageviews:      snapshot.total_pageviews,
          avg_session_duration: snapshot.avg_session_duration,
          bounce_rate:          snapshot.bounce_rate,
          top_pages:            snapshot.top_pages,
          top_sources:          snapshot.top_sources,
          synced_at:            snapshot.synced_at,
        },
        { onConflict: 'client_id,period_start,period_end' },
      )
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, snapshot_id: (data as { id: string }).id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

async function syncMeta(
  clientId: string,
  adAccountId: string,
  accessToken: string,
): Promise<{ success: boolean; snapshot_id?: string; error?: string }> {
  try {
    const today        = new Date()
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(today.getDate() - 30)
    const since = thirtyDaysAgo.toISOString().slice(0, 10)
    const until = today.toISOString().slice(0, 10)

    const [insights, campaigns] = await Promise.all([
      getAdAccountInsights(adAccountId, accessToken, since, until),
      getAdCampaignInsights(adAccountId, accessToken, since, until),
    ])

    if (!insights) {
      return { success: false, error: 'getAdAccountInsights returned null — check META_SYSTEM_USER_TOKEN and ad account ID' }
    }

    const { data, error } = await supabaseAdmin
      .from('meta_ads_snapshots')
      .insert({
        client_id:    clientId,
        ad_account_id: adAccountId,
        period_start: since,
        period_end:   until,
        spend:        insights.spend,
        impressions:  insights.impressions,
        clicks:       insights.clicks,
        conversions:  insights.conversions,
        roas:         insights.roas,
        cpc:          insights.cpc,
        ctr:          insights.ctr,
        campaigns:    campaigns.length > 0 ? campaigns : null,
        raw_data:     insights,
      })
      .select('id')
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, snapshot_id: (data as { id: string }).id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
