/**
 * GET /api/cron/google-data-pullback-daily
 *
 * Daily cron — pulls GSC + GA4 + Meta Ads + Google Ads snapshots for every client.
 * Upserts into gsc_performance_snapshots, ga4_traffic_snapshots,
 * meta_ads_snapshots, and writes Google Ads aggregates into flywheel_metrics.
 *
 * Schedule: daily at 3am UTC (~3pm NZST)
 * Auth: Bearer ${CRON_SECRET}
 * Max duration: 15 min (Render standard plan)
 *
 * Per-client logic:
 *   - GSC:        anchor='gsc',  status='connected', config.site_url
 *   - GA4:        anchor='ga4',  status='connected', config.property_id
 *   - Meta Ads:   clients.meta_ad_account_id + META_SYSTEM_USER_TOKEN env
 *   - Google Ads: platform_oauth_connections (provider='google_ads', status='active')
 *                 + GOOGLE_ADS_DEVELOPER_TOKEN / CLIENT_ID / CLIENT_SECRET /
 *                 REFRESH_TOKEN env
 *
 * Reference: ROADMAP.md P17.A.4, P17.B.3, P18.B.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGscSnapshot } from '@/lib/gsc/client'
import { fetchGa4Snapshot, fetchGa4PaidSearchMetrics } from '@/lib/ga4/client'
import { getAdAccountInsights, getAdCampaignInsights, MetaAdsInsights } from '@/lib/meta/client'
import { fetchAccountInsights, loadGoogleAdsCreds } from '@/lib/google-ads/client'
import { SEO_METRIC_KEY, GA4_METRIC_KEY, ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { MetaAdsAdapter } from '@/lib/flywheel/adapters/MetaAdsAdapter'
import { startCronRun } from '@/lib/cron/run-logger'
import { domainToEnvKey } from '@/lib/meta/token-manager'
import { syncCampaignDailyInsights } from '@/lib/ads-strategy/daily-insights'
import { evaluateClientAdHealth } from '@/lib/ads-strategy/evaluate'
import { sendAdHealthDigest } from '@/lib/ads-strategy/digest'
import { loadAdStrategyConfigWithSource, resolveDigestRecipients } from '@/lib/ads-strategy/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectorRow {
  client_id: string
  anchor:    'gsc' | 'ga4'
  config:    Record<string, unknown> | null
}

interface ClientWork {
  client_id:               string
  client_name?:            string
  client_domain?:          string
  site_url?:               string
  property_id?:            string
  meta_ad_account_id?:     string
  google_ads_customer_id?: string
}

interface ClientResult {
  client_id: string
  gsc?:       { success: boolean; snapshot_id?: string; error?: string }
  ga4?:       { success: boolean; snapshot_id?: string; error?: string }
  meta?:      { success: boolean; snapshot_id?: string; error?: string }
  /** Google Ads sync emits metrics straight into flywheel_metrics — no
   *  snapshot table yet, so `metrics_written` mirrors the spend/impressions
   *  count instead of a `snapshot_id`. */
  google_ads?: { success: boolean; metrics_written?: number; error?: string }
  /** P21.K.1 campaign-level daily series → ad_daily_insights. */
  ad_daily?:  { success: boolean; rows_written?: number; backfilled?: boolean; error?: string }
  /** P21.K.2 daily ad-health verdict → ad_health_narratives. */
  ad_health?: { success: boolean; overall_verdict?: string; campaigns_evaluated?: number; error?: string }
  /** P21.K.4 daily email digest decision + send outcome. */
  ad_digest?: { sent: boolean; decision: string; error?: string }
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

  const cronRun = await startCronRun('google-data-pullback-daily')

  // ── 1. Load connected Google connectors + Meta + Google Ads accounts in parallel
  const [connResult, metaResult, googleAdsResult] = await Promise.all([
    supabaseAdmin
      .from('client_connectors')
      .select('client_id, anchor, config')
      .in('anchor', ['gsc', 'ga4'])
      .eq('status', 'connected'),
    supabaseAdmin
      .from('clients')
      .select('id, name, domain, meta_ad_account_id')
      .not('meta_ad_account_id', 'is', null),
    // Google Ads customer_id lives in platform_oauth_connections.account_id
    // for now (PR #2 moves it to clients.google_ads_customer_id with a
    // backwards-compatible fallback). Only 'active' connections sync.
    supabaseAdmin
      .from('platform_oauth_connections')
      .select('client_id, account_id')
      .eq('provider', 'google_ads')
      .eq('status', 'active')
      .not('account_id', 'is', null),
  ])

  if (connResult.error) {
    await cronRun.finish({ failed: 1, error: connResult.error.message })
    return NextResponse.json(
      { error: `Failed to load connectors: ${connResult.error.message}` },
      { status: 500 },
    )
  }

  const connectors = connResult.data
  const metaClients = (metaResult.data ?? []) as Array<{ id: string; name: string; domain: string | null; meta_ad_account_id: string }>
  // googleAdsResult.error is non-fatal (table may not exist in some envs) — log
  // and proceed with an empty list rather than failing the whole cron run.
  if (googleAdsResult.error) {
    console.warn(
      '[cron] google_ads connections lookup failed (non-fatal):',
      googleAdsResult.error.message,
    )
  }
  const googleAdsClients = (googleAdsResult.data ?? []) as Array<{ client_id: string; account_id: string }>

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
    entry.client_name = c.name
    entry.client_domain = c.domain ?? undefined
    entry.meta_ad_account_id = c.meta_ad_account_id
    workMap.set(c.id, entry)
  }

  // Merge Google Ads clients into work map
  for (const c of googleAdsClients) {
    const entry = workMap.get(c.client_id) ?? { client_id: c.client_id }
    entry.google_ads_customer_id = c.account_id
    workMap.set(c.client_id, entry)
  }

  const work = Array.from(workMap.values()).filter(
    w =>
      w.site_url !== undefined ||
      w.property_id !== undefined ||
      w.meta_ad_account_id !== undefined ||
      w.google_ads_customer_id !== undefined,
  )

  if (work.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({
      success:           true,
      message:           'No clients with connected data sources — nothing to sync',
      clients_processed: 0,
      gsc_synced:        0,
      ga4_synced:        0,
      meta_synced:       0,
      google_ads_synced: 0,
      failed:            0,
      results:           [],
    })
  }

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

    if (client.meta_ad_account_id) {
      // Token resolution, three schemes in priority order:
      //   1. META_SYSTEM_USER_TOKEN_<DOMAIN> via getMetaTokenForClient — the
      //      scheme winner-sync runs on in production (proven working for CTS)
      //   2. legacy {NAME_SLUG}_META_SYSTEM_USER_TOKEN (kept for back-compat)
      //   3. global META_SYSTEM_USER_TOKEN (getMetaTokenForClient's own fallback)
      // The old slug-first order made CTS pull fail on 2026-07-24: the global
      // token has no access to act_2775766642787274, while the domain-scheme
      // token does — but was never consulted here.
      const slug = (client.client_name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '_')
      const domainKey = client.client_domain ? domainToEnvKey(client.client_domain) : null
      const metaToken =
        (domainKey ? process.env[`META_SYSTEM_USER_TOKEN_${domainKey}`] : undefined)
        || (slug ? process.env[`${slug}_META_SYSTEM_USER_TOKEN`] : undefined)
        || process.env.META_SYSTEM_USER_TOKEN
      if (metaToken) {
        result.meta = await syncMeta(client.client_id, client.meta_ad_account_id, metaToken, slug)

        // P21.K.5: per-client on/off. The snapshot above still runs (it feeds
        // the monthly report etc.); only the Ad Strategy Engine honours the
        // switch, so an FDE can silence a client without losing base data.
        const { config: adStrategyConfig, source: adConfigSource } =
          await loadAdStrategyConfigWithSource(client.client_id)

        // P21.K.1: campaign-level DAILY series for the Ad Strategy Engine.
        // Separate from the 30-day rolling snapshot above, which cannot answer
        // "has this campaign decayed against its own baseline" — its rows
        // overlap by 29 days and truncate campaigns to the top 10 by spend.
        // Kept non-fatal: the snapshot is the pre-existing contract (read by
        // MetaAdsAdapter, the monthly report and the production-package view)
        // and must not regress if this newer pull fails.
        if (adStrategyConfig.enabled) {
          result.ad_daily = await syncCampaignDailyInsights(
            client.client_id,
            client.meta_ad_account_id,
            metaToken,
          )

          // P21.K.2: judge each campaign against its own baseline and store the
          // day's account-health narrative. Reads the series just written above.
          // Non-fatal — a judging failure must not affect data collection.
          if (result.ad_daily?.success) {
            const insightDate = new Date()
            insightDate.setUTCDate(insightDate.getUTCDate() - 1)
            const insightDateStr = insightDate.toISOString().slice(0, 10)
            result.ad_health = await evaluateClientAdHealth(client.client_id, insightDateStr)

            // P21.K.4: email the day's digest (best-effort). Green is
            // de-frequenced so the PM isn't trained to ignore a daily 🟢.
            // Recipients come from per-client config (P21.K.5), else global inbox.
            // Skip sending when the config was a read-error fallback: enabled is
            // then a guess, and re-opening a paused client to email is the one
            // irreversible mistake we don't fail-open on (魏征).
            if (adConfigSource !== 'fallback' && result.ad_health?.success && result.ad_health.overall_verdict) {
              const digest = await sendAdHealthDigest(
                client.client_id,
                client.client_name ?? 'Client',
                insightDateStr,
                resolveDigestRecipients(adStrategyConfig),
              )
              result.ad_digest = { sent: digest.sent, decision: digest.decision, error: digest.error }
            }
          }
        }
      }
    }

    if (client.google_ads_customer_id) {
      result.google_ads = await syncGoogleAds(client.client_id, client.google_ads_customer_id)
    }

    results.push(result)
  }

  // ── 4. Tally results ───────────────────────────────────────────────────────
  const gscSynced       = results.filter(r => r.gsc?.success).length
  const ga4Synced       = results.filter(r => r.ga4?.success).length
  const metaSynced      = results.filter(r => r.meta?.success).length
  const googleAdsSynced = results.filter(r => r.google_ads?.success).length
  const adDailySynced   = results.filter(r => r.ad_daily?.success).length
  const adDailyRows     = results.reduce((sum, r) => sum + (r.ad_daily?.rows_written ?? 0), 0)
  const adHealthSynced  = results.filter(r => r.ad_health?.success).length
  const adHealthAlerts  = results.filter(r => r.ad_health?.overall_verdict === 'alert').length
  const failed          = results.filter(
    r =>
      r.gsc?.success === false ||
      r.ga4?.success === false ||
      r.meta?.success === false ||
      r.google_ads?.success === false ||
      r.ad_daily?.success === false ||
      r.ad_health?.success === false,
  ).length

  // Collect per-client errors so postmortem is possible without Render logs.
  // Diagnostic only — no behavior change.
  const errors = results.flatMap(r => {
    const out: Array<{ client_id: string; source: 'gsc'|'ga4'|'meta'|'google_ads'|'ad_daily'|'ad_health'|'ad_digest'; error: string }> = []
    if (r.gsc?.success === false && r.gsc.error)               out.push({ client_id: r.client_id, source: 'gsc',        error: r.gsc.error })
    if (r.ga4?.success === false && r.ga4.error)               out.push({ client_id: r.client_id, source: 'ga4',        error: r.ga4.error })
    if (r.meta?.success === false && r.meta.error)             out.push({ client_id: r.client_id, source: 'meta',       error: r.meta.error })
    if (r.google_ads?.success === false && r.google_ads.error) out.push({ client_id: r.client_id, source: 'google_ads', error: r.google_ads.error })
    if (r.ad_daily?.success === false && r.ad_daily.error)     out.push({ client_id: r.client_id, source: 'ad_daily',   error: r.ad_daily.error })
    if (r.ad_health?.success === false && r.ad_health.error)   out.push({ client_id: r.client_id, source: 'ad_health', error: r.ad_health.error })
    if (r.ad_digest && !r.ad_digest.sent && r.ad_digest.error)  out.push({ client_id: r.client_id, source: 'ad_digest', error: r.ad_digest.error })
    return out
  })

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: { gsc_synced: gscSynced, ga4_synced: ga4Synced, meta_synced: metaSynced, google_ads_synced: googleAdsSynced, ad_daily_synced: adDailySynced, ad_daily_rows: adDailyRows, ad_health_synced: adHealthSynced, ad_health_alerts: adHealthAlerts, errors },
  })
  return NextResponse.json({
    success:           true,
    clients_processed: results.length,
    gsc_synced:        gscSynced,
    ga4_synced:        ga4Synced,
    meta_synced:       metaSynced,
    google_ads_synced: googleAdsSynced,
    ad_daily_synced:   adDailySynced,
    ad_daily_rows:     adDailyRows,
    ad_health_synced:  adHealthSynced,
    ad_health_alerts:  adHealthAlerts,
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

    // Write GSC totals into flywheel_metrics so AnomalyDetectorJob can read them.
    // No unique constraint on (client_id, metric_key, measured_at), so delete today's
    // existing rows first then insert fresh values — both steps are non-fatal.
    const today      = new Date().toISOString().slice(0, 10)
    const todayStart = `${today}T00:00:00.000Z`
    const todayEnd   = `${today}T23:59:59.999Z`
    const gscMetricKeys = [
      SEO_METRIC_KEY.GSC_CLICKS,
      SEO_METRIC_KEY.GSC_IMPRESSIONS,
      SEO_METRIC_KEY.GSC_AVG_POSITION,
    ]
    await supabaseAdmin
      .from('flywheel_metrics')
      .delete()
      .eq('client_id', clientId)
      .in('metric_key', gscMetricKeys)
      .gte('measured_at', todayStart)
      .lte('measured_at', todayEnd)
      .then(() => {}, () => {})

    const metricsRows = [
      { metric_key: SEO_METRIC_KEY.GSC_CLICKS,       metric_value: snapshot.total_clicks },
      { metric_key: SEO_METRIC_KEY.GSC_IMPRESSIONS,  metric_value: snapshot.total_impressions },
      { metric_key: SEO_METRIC_KEY.GSC_AVG_POSITION, metric_value: snapshot.avg_position },
    ].map(m => ({
      client_id:    clientId,
      flywheel:     'seo' as const,
      metric_key:   m.metric_key,
      metric_value: m.metric_value,
      source:       'gsc_pullback',
      measured_at:  new Date().toISOString(),
    }))

    await supabaseAdmin
      .from('flywheel_metrics')
      .insert(metricsRows)
      .then(() => {}, () => { /* non-fatal — snapshot already saved */ })

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

    // Write GA4 traffic metrics into flywheel_metrics so AnomalyDetectorJob can read them.
    // No unique constraint on (client_id, metric_key, measured_at), so delete today's
    // existing rows first then insert fresh values — both steps are non-fatal.
    const today      = new Date().toISOString().slice(0, 10)
    const todayStart = `${today}T00:00:00.000Z`
    const todayEnd   = `${today}T23:59:59.999Z`
    const ga4MetricKeys = [
      GA4_METRIC_KEY.SESSIONS,
      GA4_METRIC_KEY.USERS,
      GA4_METRIC_KEY.PAGEVIEWS,
      GA4_METRIC_KEY.BOUNCE_RATE,
      GA4_METRIC_KEY.AVG_SESSION_DURATION,
    ]
    await supabaseAdmin
      .from('flywheel_metrics')
      .delete()
      .eq('client_id', clientId)
      .in('metric_key', ga4MetricKeys)
      .gte('measured_at', todayStart)
      .lte('measured_at', todayEnd)
      .then(() => {}, () => {})

    const ga4MetricsRows = [
      { metric_key: GA4_METRIC_KEY.SESSIONS,             metric_value: snapshot.total_sessions },
      { metric_key: GA4_METRIC_KEY.USERS,                metric_value: snapshot.total_users },
      { metric_key: GA4_METRIC_KEY.PAGEVIEWS,            metric_value: snapshot.total_pageviews },
      { metric_key: GA4_METRIC_KEY.BOUNCE_RATE,          metric_value: snapshot.bounce_rate },
      { metric_key: GA4_METRIC_KEY.AVG_SESSION_DURATION, metric_value: snapshot.avg_session_duration },
    ].map(m => ({
      client_id:    clientId,
      flywheel:     'seo' as const,
      metric_key:   m.metric_key,
      metric_value: m.metric_value,
      source:       'ga4_pullback',
      measured_at:  new Date().toISOString(),
    }))

    await supabaseAdmin
      .from('flywheel_metrics')
      .insert(ga4MetricsRows)
      .then(() => {}, () => { /* non-fatal — snapshot already saved */ })

    // Pull paid search metrics from GA4 and write to the ads flywheel.
    // Non-fatal: if the account has no paid search traffic the rows will be 0.
    const paidMetrics = await fetchGa4PaidSearchMetrics(propertyId, clientId).catch(() => null)
    if (paidMetrics) {
      const paidKeys = [
        ADS_METRIC_KEY.GA4_PAID_SESSIONS,
        ADS_METRIC_KEY.GA4_PAID_USERS,
        ADS_METRIC_KEY.GA4_PAID_CONVERSIONS,
      ]
      await supabaseAdmin
        .from('flywheel_metrics')
        .delete()
        .eq('client_id', clientId)
        .eq('source', 'ga4_paid_search_pullback')
        .in('metric_key', paidKeys)
        .gte('measured_at', todayStart)
        .lte('measured_at', todayEnd)
        .then(() => {}, () => {})

      const paidRows = [
        { metric_key: ADS_METRIC_KEY.GA4_PAID_SESSIONS,    metric_value: paidMetrics.paid_sessions },
        { metric_key: ADS_METRIC_KEY.GA4_PAID_USERS,       metric_value: paidMetrics.paid_users },
        { metric_key: ADS_METRIC_KEY.GA4_PAID_CONVERSIONS, metric_value: paidMetrics.paid_conversions },
      ].map(m => ({
        client_id:    clientId,
        flywheel:     'ads' as const,
        metric_key:   m.metric_key,
        metric_value: m.metric_value,
        source:       'ga4_paid_search_pullback',
        source_ref:   { period_start: paidMetrics.period_start, period_end: paidMetrics.period_end },
        measured_at:  new Date().toISOString(),
      }))

      await supabaseAdmin
        .from('flywheel_metrics')
        .insert(paidRows)
        .then(() => {}, () => { /* non-fatal */ })
    }

    return { success: true, snapshot_id: (data as { id: string }).id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

async function syncMeta(
  clientId: string,
  adAccountId: string,
  accessToken: string,
  clientSlug: string,
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

    // Write Meta Ads metrics into flywheel_metrics so AnomalyDetectorJob can read them.
    // pullMetrics() reads the latest meta_ads_snapshots row (just inserted above).
    await new MetaAdsAdapter().pullMetrics(clientId).catch(() => { /* non-fatal */ })

    // Append daily row to Airtable Meta Ads Daily table (non-fatal).
    await appendAirtableMetaDaily(clientSlug, adAccountId, insights, until).catch(() => {})

    return { success: true, snapshot_id: (data as { id: string }).id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Sync Google Ads account-level metrics for one client.
 *
 * Writes 30-day aggregates straight into flywheel_metrics under the shared
 * `ads.account.*` namespace, discriminating by `source='google_ads_pullback'`
 * so a client with both Meta + Google Ads stays distinguishable. No snapshot
 * table yet — we'll add one when the prescription engine wants per-campaign
 * history (separate PR; out of scope for the skeleton).
 *
 * Returns `success: false` (not a throw) so a missing/expired token or a
 * single broken account doesn't kill the rest of the cron run.
 */
async function syncGoogleAds(
  clientId: string,
  customerId: string,
): Promise<{ success: boolean; metrics_written?: number; error?: string }> {
  try {
    const creds = loadGoogleAdsCreds(customerId)
    if (!creds) {
      return {
        success: false,
        error:
          'GOOGLE_ADS_* env vars missing — set DEVELOPER_TOKEN, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN in Render env',
      }
    }

    const insights = await fetchAccountInsights(creds, 30)
    if (!insights) {
      return {
        success: false,
        error:
          'fetchAccountInsights returned null — check developer token approval status and customer_id',
      }
    }

    // No unique constraint on (client_id, metric_key, measured_at) for the
    // `ads.account.*` namespace, so delete today's google_ads_pullback rows
    // first to avoid stale dupes accumulating across cron retries.
    const today      = new Date().toISOString().slice(0, 10)
    const todayStart = `${today}T00:00:00.000Z`
    const todayEnd   = `${today}T23:59:59.999Z`
    const adsMetricKeys = [
      ADS_METRIC_KEY.SPEND,
      ADS_METRIC_KEY.IMPRESSIONS,
      ADS_METRIC_KEY.CLICKS,
      ADS_METRIC_KEY.CTR,
      ADS_METRIC_KEY.CPC,
      ADS_METRIC_KEY.CONVERSIONS,
      ADS_METRIC_KEY.CPA,
    ]
    await supabaseAdmin
      .from('flywheel_metrics')
      .delete()
      .eq('client_id', clientId)
      .eq('source', 'google_ads_pullback')
      .in('metric_key', adsMetricKeys)
      .gte('measured_at', todayStart)
      .lte('measured_at', todayEnd)
      .then(() => {}, () => {})

    const measuredAt = new Date().toISOString()
    const rows = [
      { metric_key: ADS_METRIC_KEY.SPEND,       metric_value: insights.spend },
      { metric_key: ADS_METRIC_KEY.IMPRESSIONS, metric_value: insights.impressions },
      { metric_key: ADS_METRIC_KEY.CLICKS,      metric_value: insights.clicks },
      { metric_key: ADS_METRIC_KEY.CTR,         metric_value: insights.ctr },
      { metric_key: ADS_METRIC_KEY.CPC,         metric_value: insights.cpc },
      { metric_key: ADS_METRIC_KEY.CONVERSIONS, metric_value: insights.conversions },
      { metric_key: ADS_METRIC_KEY.CPA,         metric_value: insights.cpa },
    ].map(m => ({
      client_id:    clientId,
      flywheel:     'ads' as const,
      metric_key:   m.metric_key,
      metric_value: m.metric_value,
      source:       'google_ads_pullback',
      source_ref:   {
        customer_id:  customerId,
        period_start: insights.period_start,
        period_end:   insights.period_end,
      },
      measured_at:  measuredAt,
    }))

    const { error } = await supabaseAdmin.from('flywheel_metrics').insert(rows)
    if (error) return { success: false, error: error.message }

    return { success: true, metrics_written: rows.length }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Airtable Meta Ads Daily append ──────────────────────────────────────────
// Appends one row per client per day to the client's Airtable "Meta Ads Daily"
// table. Requires env vars: AIRTABLE_API_KEY, {SLUG}_AIRTABLE_META_BASE_ID,
// {SLUG}_AIRTABLE_META_TABLE_ID. Silently skips if any are missing.
async function appendAirtableMetaDaily(
  clientSlug: string,
  adAccountId: string,
  insights: MetaAdsInsights,
  dateStr: string,
): Promise<void> {
  const apiKey  = process.env.AIRTABLE_API_KEY
  const baseId  = process.env[`${clientSlug}_AIRTABLE_META_BASE_ID`]
  const tableId = process.env[`${clientSlug}_AIRTABLE_META_TABLE_ID`]
  if (!apiKey || !baseId || !tableId) return

  const ctrPct = insights.ctr != null ? Math.round(insights.ctr * 10000) / 100 : null

  const fields: Record<string, unknown> = {
    'Date':        dateStr,
    'Ad Name':     'Daily Account Total (auto)',
    'Campaign ID': adAccountId,
    'Impressions': insights.impressions,
    'Clicks':      insights.clicks,
    'Spend NZD':   insights.spend,
    'Status':      'ACTIVE',
    'Note':        `Auto-synced ${dateStr}. NZ$${insights.spend.toFixed(2)} spend / ${insights.impressions.toLocaleString()} imp / ${insights.clicks} clicks${ctrPct != null ? ` / CTR ${ctrPct}%` : ''}`,
  }
  if (ctrPct != null)       fields['CTR %']   = ctrPct
  if (insights.cpc != null) fields['CPC NZD'] = insights.cpc

  await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields }),
  })
}
