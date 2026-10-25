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
 *                 (30-day snapshot + MetaAdsAdapter feed — primary account only,
 *                 see 2026-09-13 note below)
 *   - Ad Strategy Engine daily series (ad_daily_insights, health, digest):
 *                 ALL of the client's registered accounts —
 *                 `client_meta_ad_accounts` (2026-09-13, see note below)
 *   - Google Ads: platform_oauth_connections (provider='google_ads', status='active')
 *                 + GOOGLE_ADS_DEVELOPER_TOKEN / CLIENT_ID / CLIENT_SECRET /
 *                 REFRESH_TOKEN env
 *
 * 2026-09-13 multi-account fix: CTS runs a second Meta ad account
 * (act_2202695063810470, "CTStours 官方账户") that `meta_ad_account_id` never
 * captured — its ThruPlay spend was invisible to ad_daily_insights, the health
 * engine, and the daily digest. The 30-day `meta_ads_snapshots` pull above
 * (`syncMeta`) still only covers the primary account — extending that table
 * to multi-account is a separate, larger change not needed to close this gap;
 * `ad_daily_insights` is what the health/digest/readback-sweep pipeline
 * actually reads, so that's the loop that now covers every registered account.
 * See src/lib/meta/client-ad-accounts.ts.
 *
 * Known scope boundary (2026-09-13 review): the client candidate list above
 * (`metaClients`/`work`) still keys off `clients.meta_ad_account_id` alone —
 * a client with ONLY a secondary account registered (e.g. its primary was
 * cleared via the settings route) won't enter this loop at all, so it gets no
 * ad_daily_insights/health/digest until the primary is restored. The daily
 * SAFETY sweep (readback-sweep.ts) does not have this gap — it checks both
 * the old column and the new table. This one is lower priority (loses
 * analytics, not the safety gate) and is tracked in ROADMAP rather than fixed
 * here, to avoid rushing a change into this route's per-client loop.
 *

 * Reference: ROADMAP.md P17.A.4, P17.B.3, P18.B.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGscSnapshot } from '@/lib/gsc/client'
import { gscSiteUrlFromConfig } from '@/lib/gsc/connected-clients'
import { fetchGa4Snapshot, fetchGa4PaidSearchMetrics } from '@/lib/ga4/client'
import { getAdAccountInsightsResult, getAdCampaignInsights, MetaAdsInsights } from '@/lib/meta/client'
import { fetchAccountInsights, loadGoogleAdsCreds } from '@/lib/google-ads/client'
import { SEO_METRIC_KEY, GA4_METRIC_KEY, ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { adsMetricKeysWrittenBy } from '@/lib/flywheel/metric-registry'
import { MetaAdsAdapter } from '@/lib/flywheel/adapters/MetaAdsAdapter'
import { startCronRun } from '@/lib/cron/run-logger'
import { resolveMetaTokenDetailed, ownsKey, loadTokenOwnerPeers, type TokenOwnerRow } from '@/lib/meta/token-selection'
import { findSharedAdAccounts, getClientAdAccountIds } from '@/lib/meta/client-ad-accounts'
import { hasVideoColumns, syncAdDailyInsights, syncAdsetDailyInsights, syncCampaignDailyInsights } from '@/lib/ads-strategy/daily-insights'
import { buildGrowthState } from '@/lib/ads-strategy/agents/patrol'
import { reconcileAutonomyMode } from '@/lib/ads-strategy/autonomy/notify'
import { probeClientCircuit, type ClientProbe } from '@/lib/ads-strategy/circuit-probe'
import { resolveClientEvaluationDate } from '@/lib/ads-strategy/account-timezone'
import { evaluateClientAdHealth } from '@/lib/ads-strategy/evaluate'
import { sendAdHealthDigest } from '@/lib/ads-strategy/digest'
import { runPortfolioDiagnostics } from '@/lib/ads-strategy/portfolio/run-daily'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { ADS_DIAGNOSTICS_COMPLETED_EVENT } from '@/lib/inngest/functions/ads-d3-auto-pause'
import { snapshotTablesExist } from '@/lib/ads-strategy/portfolio/snapshot-sync'
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
  site_url?:               string
  property_id?:            string
  meta_ad_account_id?:     string
  google_ads_customer_id?: string
}

interface ClientResult {
  client_id: string
  gsc?:       { success: boolean; snapshot_id?: string; error?: string }
  ga4?:       { success: boolean; snapshot_id?: string; error?: string }
  meta?:      { success: boolean; snapshot_id?: string; error?: string; skipped?: 'no_active_ads' }
  /** Google Ads sync emits metrics straight into flywheel_metrics — no
   *  snapshot table yet, so `metrics_written` mirrors the spend/impressions
   *  count instead of a `snapshot_id`. */
  google_ads?: { success: boolean; metrics_written?: number; error?: string }
  /** P21.K.1 campaign-level daily series → ad_daily_insights. */
  ad_daily?:  { success: boolean; rows_written?: number; backfilled?: boolean; error?: string }
  /** P21.K.7 ad-level daily series → ad_daily_insights (level='ad'). */
  ad_level?:  { success: boolean; rows_written?: number; backfilled?: boolean; error?: string }
  /** P21.K.2 daily ad-health verdict → ad_health_narratives. */
  ad_health?: { success: boolean; overall_verdict?: string; campaigns_evaluated?: number; error?: string }
  /** P21.K.4 daily email digest decision + send outcome. */
  ad_digest?: { sent: boolean; decision: string; error?: string }
  /** ads IMPACT 阶段 1：只读诊断 + 内部版日报 */
  ad_diagnostics?: { success: boolean; hits: number; not_comparable: number; excluded: number; digest_decision?: string; digest_sent?: boolean; recipients_dropped?: number; error?: string }
  /**
   * 广告引擎配置**读失败**（不是没配置行）。2026-09-25 事故：读配置每次 400，
   * 下面的诊断 / 经营状态 / 日报全按 fallback 静默跳过，运行记录里一个字没有。
   * 计入 `failed`，并优先当失败邮件头条 —— 它一坏就是所有客户一起停。
   */
  ad_config?: { success: false; error: string }
  /** Ads D3 自动暂停：诊断完成后发给 Inngest 的事件（consumer 自己判要不要出手）。 */
  ad_auto_pause_event?: { sent: boolean; error?: string }
  /** 卫青巡察：问题 + 机会 + 目标节奏 → ads_growth_states 一行（spec 2026-09-24 §4）。 */
  ads_growth_state?: { success: boolean; date?: string; problems?: number; opportunities?: number; completeness?: string; error?: string }
  /** WP3.1a 每日 reconcile：给同步 worker 发一次叫醒铃（同一幂等 id，Inngest 24h 去重）。best-effort，不进 failed。 */
  autonomy_sync?: { sent: boolean; events: number; error?: string }
  /**
   * A0 只读熔断探针（观察期）：五条判据在真实数据上判出了什么。
   * **只读、不写任何表**；这一项会被汇总进 `cron_run_logs.summary`，
   * 因为 HTTP 响应体 Render 直接丢掉（`render.yaml` 那条 curl 不留 body）。
   */
  circuit_probe?: ClientProbe | { error: string }
  /**
   * 2026-09-13: `ad_daily`/`ad_level` above stay the PRIMARY account's result
   * (unchanged shape, unchanged tallying). Any additional registered accounts
   * (client_meta_ad_accounts) land here instead — purely additive, so nothing
   * that reads `ad_daily`/`ad_level` needs to change.
   */
  ad_daily_secondary?: Array<{
    ad_account_id: string
    ad_daily?: { success: boolean; rows_written?: number; error?: string }
    ad_level?:  { success: boolean; rows_written?: number; error?: string }
    adset_level?: { success: boolean; rows_written?: number; error?: string }
  }>
  adset_level?: { success: boolean; rows_written?: number; error?: string }
}

/**
 * Ads D3 自动暂停：诊断成功后发一条事件。事件只带三个字段——`client_id` /
 * `insight_date` / `diagnostic_run_id`（`ad_health_narratives.id`）——不带
 * 诊断明细、不带客户名、不带具体数字（子牙复审：防止客户事实混进 shared
 * 事件契约）。consumer 拿这三个字段回库查开关和诊断结果。
 *
 * `diagnostic_run_id` 读不到（行还没写、或读取失败）就不发——没有稳定的
 * run id，consumer 那边也没法把 flywheel_actions 记录挂对。
 */
async function fireAdsDiagnosticsCompletedEvent(
  clientId: string,
  insightDate: string,
): Promise<{ sent: boolean; error?: string }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('ad_health_narratives')
      .select('id')
      .eq('client_id', clientId)
      .eq('insight_date', insightDate)
      .maybeSingle()
    if (error || !data) {
      return { sent: false, error: error?.message ?? 'ad_health_narratives 行未找到' }
    }
    await sendInngestEvent({
      id: `ads-diagnostics-completed:${clientId}:${insightDate}`,
      name: ADS_DIAGNOSTICS_COMPLETED_EVENT,
      data: { client_id: clientId, insight_date: insightDate, diagnostic_run_id: (data as { id: string }).id },
    })
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) }
  }
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

  // ads IMPACT 阶段 1：视频完播 + actions 9 列（migration 20260914000001）在不在库里。
  // 不在就照旧只写老列——不能为了新列把现有每日数据同步整条弄挂。结果进 summary。
  const withVideo = await hasVideoColumns()
  // 快照表在不在（migration 20260914000001）：在 → 跑只读诊断发内部版日报；不在 → 照旧发原日报
  const snapshotsReady = await snapshotTablesExist()

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
      // Same "usable GSC property" rule as the per-page daily fan-out roster.
      const siteUrl = gscSiteUrlFromConfig(row.config)
      if (siteUrl) entry.site_url = siteUrl
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

  // Loaded at most once per run (memoized) — the ownership snapshot every
  // scoped-token client's domain/Page check AND every legacy-name check both
  // need. resolveMetaTokenDetailed used to reload this with its own full
  // `clients` scan for EACH client carrying a scoped env var; sharing one
  // snapshot for the whole run avoids that per-client cost (chatgpt-codex-
  // connector review, 2026-09-21).
  /**
   * 熔断探针整轮用同一个「现在」（魏征复审 2026-10-18）。
   *
   * 客户是串行跑的，这一轮实测 104–150 秒。如果让每个客户各自 `new Date()`，
   * 哪天拉数变慢，不同客户的「账户时区的昨天」可能落在不同日期上 ——
   * 观察期统计时那是静默的口径漂移。取一次传下去，整轮一个口径。
   */
  const probeNow = new Date()

  let tokenOwnerPeers: TokenOwnerRow[] | null | undefined
  async function getTokenOwnerPeers(): Promise<TokenOwnerRow[] | null> {
    if (tokenOwnerPeers === undefined) tokenOwnerPeers = await loadTokenOwnerPeers(supabaseAdmin)
    return tokenOwnerPeers
  }

  for (const client of work) {
    const result: ClientResult = { client_id: client.client_id }

    if (client.site_url) {
      result.gsc = await syncGsc(client.client_id, client.site_url)
    }

    if (client.property_id) {
      result.ga4 = await syncGa4(client.client_id, client.property_id)
    }

    if (client.meta_ad_account_id) {
      // Token resolution (AD-SEC-4 follow-up, 2026-09-21), four schemes in
      // priority order — unchanged from before this fix, only the ownership
      // checks are new:
      //   1. Ownership-checked domain-scoped token (resolveMetaTokenDetailed,
      //      source === 'client_domain') — same lookup every other Meta call in
      //      the app uses (token-selection.ts), called with this route's own
      //      supabaseAdmin rather than token-manager's separate client. Fixes the
      //      bug this route had (domain token never consulted, 2026-07-24 CTS
      //      pull failure) AND the hole it was written with: `client.domain` was
      //      read straight into the env-var name with no check on who owns that
      //      key, so a self-serve signup copying a real client's domain could
      //      pull that client's token.
      //   2. legacy {NAME_SLUG}_META_SYSTEM_USER_TOKEN, kept for back-compat (no
      //      reliance found in docs/ENV.md or elsewhere in the repo, but Render
      //      env vars aren't fully inventoried) — same problem as #1 applies to
      //      `clients.name` (self-serve-writable, not unique), so it only fires
      //      for this name's earliest non-self-serve owner. Checked BEFORE the
      //      Page-scoped token (step 3): this route's original order — before
      //      resolveMetaTokenDetailed's Page-scoped lookup existed here at all —
      //      was domain → legacy → global, and a client relying on the legacy
      //      token must not lose it just because a Page token happens to be
      //      configured too (a Page token's identity isn't guaranteed to have
      //      ads_management on this client's ad account — Codex review, 2026-09-21).
      //   3. Ownership-checked Page-scoped token (source === 'client_page') —
      //      only consulted once #1 and #2 both miss.
      //   4. resolveMetaTokenDetailed's own shared global fallback. Checked LAST:
      //      a client whose ad account only the per-name token can see (the exact
      //      2026-07-24 failure mode — the global token lacks access to that
      //      specific account) must not lose it just because a global fallback
      //      happens to be configured too. Steps 1 and 3 already exclude this
      //      source, so `resolved` is reused here rather than re-fetched.
      //
      // ownership_unknown (a transient failure reading who owns a scoped key,
      // NOT "nobody configured a token") deliberately withholds even the shared
      // fallback — see resolveMetaTokenDetailed's own doc comment — so it must
      // still surface as a failure below rather than silently skip the client
      // (chatgpt-codex-connector review on this PR, 2026-09-21).
      const slug = (client.client_name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '_')
      const peers = await getTokenOwnerPeers()
      const resolved = await resolveMetaTokenDetailed(supabaseAdmin, client.client_id, process.env, peers)
      let metaToken = resolved !== 'ownership_unknown' && resolved && (resolved.source === 'client_db' || resolved.source === 'client_domain') ? resolved.token : undefined
      const legacyToken = slug ? process.env[`${slug}_META_SYSTEM_USER_TOKEN`] : undefined
      let legacyOwnershipDenied = false
      // Distinct from "denied": the ownership snapshot itself failed to load, so
      // we cannot tell whether this client owns the legacy key or not. Falling
      // through to Page/global below would silently swap it onto a token
      // "known" not to work for it whenever this happens to be the client that
      // relies on the legacy token (chatgpt-codex-connector review, 2026-09-21)
      // — treat it exactly like resolveMetaTokenDetailed's own 'ownership_unknown'.
      let legacyOwnershipUnknown = false
      // resolved === 'ownership_unknown' means THIS CLIENT'S OWN ROW couldn't be
      // read — a completely different query from the peers snapshot the legacy
      // check below verifies against, so it can't actually invalidate that
      // verification. Still refused: once we know we don't have the full,
      // trustworthy picture of this client, using ANY alternative credential for
      // it this run is exactly the guess this whole fail-closed design exists to
      // refuse, not just the domain/Page one (chatgpt-codex-connector review,
      // 2026-09-21).
      if (!metaToken && legacyToken && resolved !== 'ownership_unknown') {
        if (peers === null) {
          legacyOwnershipUnknown = true
        } else {
          const self = peers.find((p) => p.id === client.client_id)
          // `self.name` comes from the same shared peer snapshot as `peers` — but
          // the SNAPSHOT can still have loaded after the `metaResult` row `slug`
          // was built from (both read at the top of a run that can take minutes).
          // Overriding `.name` with `client.client_name` here guarantees ownsKey
          // verifies ownership of the SAME key `legacyToken` was just looked up
          // with, not whatever name this client happens to carry in the snapshot
          // (魏征 review, 2026-09-21: an ordinary rename mid-run could otherwise
          // make this check pass for a key the client was never actually granted).
          if (self && ownsKey({ ...self, name: client.client_name }, peers, (r) => (r.name ? r.name.toUpperCase().replace(/[^A-Z0-9]/g, '_') : null))) {
            metaToken = legacyToken
          } else {
            legacyOwnershipDenied = true
          }
        }
      }
      const ownershipUnknown = resolved === 'ownership_unknown' || legacyOwnershipUnknown
      if (!metaToken && !ownershipUnknown && resolved && resolved.source === 'client_page') metaToken = resolved.token
      if (!metaToken && !ownershipUnknown) metaToken = resolved?.token
      if (metaToken) {
        result.meta = await syncMeta(client.client_id, client.meta_ad_account_id, metaToken, slug)

        // P21.K.5: per-client on/off. The snapshot above still runs (it feeds
        // the monthly report etc.); only the Ad Strategy Engine honours the
        // switch, so an FDE can silence a client without losing base data.
        const { config: adStrategyConfig, source: adConfigSource, error: adConfigError } =
          await loadAdStrategyConfigWithSource(client.client_id)
        if (adConfigSource === 'fallback') {
          result.ad_config = {
            success: false,
            error: `ad_strategy_configs read failed — diagnostics, growth state and digest skipped for this client: ${adConfigError ?? 'unknown error'}`,
          }
        }

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
            { withVideo },
          )

          // 2026-09-13: any OTHER accounts this client has registered
          // (client_meta_ad_accounts) get the same two syncs, so their
          // campaigns/ads land in ad_daily_insights too — that table has no
          // account filter downstream (evaluateClientAdHealth, the digest,
          // readback-sweep all just query by client_id), so this is the one
          // change needed for those to start seeing every account.
          // Non-fatal per account: one account's failure must not skip the rest.
          const allAccountIds = await getClientAdAccountIds(client.client_id)
          const secondaryAccountIds = allAccountIds.filter(id => id !== client.meta_ad_account_id)
          // ads IMPACT §14 M9：新增的广告组级同步对共用账户（同账户登记给多个客户）跳过，
          // 不把同一批广告组写进两家名下。系列级/广告级的老同步维持原状（既有问题，诊断读侧另做隔离）。
          // 查询出错 fail closed：全部当共用，跳过广告组级。
          const { shared: sharedAccountIds } = await findSharedAdAccounts(client.client_id, allAccountIds)
          const isShared = (id: string) => sharedAccountIds.has(id.startsWith('act_') ? id.slice(4) : id)
          const skippedShared = { success: true, rows_written: 0, error: 'skipped: shared ad account (M9)' }
          if (secondaryAccountIds.length > 0) {
            result.ad_daily_secondary = []
            for (const secondaryAccountId of secondaryAccountIds) {
              const secondaryResult: NonNullable<ClientResult['ad_daily_secondary']>[number] = {
                ad_account_id: secondaryAccountId,
              }
              secondaryResult.ad_daily = await syncCampaignDailyInsights(
                client.client_id,
                secondaryAccountId,
                metaToken,
                { withVideo },
              )
              secondaryResult.ad_level = await syncAdDailyInsights(
                client.client_id,
                secondaryAccountId,
                metaToken,
                { withVideo },
              )
              secondaryResult.adset_level = isShared(secondaryAccountId)
                ? skippedShared
                : await syncAdsetDailyInsights(client.client_id, secondaryAccountId, metaToken, { withVideo })
              result.ad_daily_secondary.push(secondaryResult)
            }
          }

          // 评估日 = 这个客户名下每个广告账户「自己时区的昨天」里最早的那一天（2026-09-24）。
          // 上游取数窗口已按账户时区算「昨天」（daily-insights.requestWindow），这一侧再按 UTC 算
          // 就会用 `lte(insight_date, …)` 把当天刚存进来的最新一天滤掉——数据白存一天才被看到。
          // 判定、原日报、只读诊断、经营状态**共用同一个日期**：数据到哪天、判定写哪天、
          // 日报标题写哪天必须是同一天，否则 PM 看到的三处日期对不上。
          // 取最早（而不是最新）的理由见 resolveClientEvaluationDate 的注释：跨时区客户上
          // 取最新会把没跑完的半天当整天喂进自动收放回路。
          const evaluationDate = await resolveClientEvaluationDate([
            client.meta_ad_account_id,
            ...allAccountIds,
          ])

          // P21.K.2: judge each campaign against its own baseline and store the
          // day's account-health narrative. Reads the series just written above
          // PLUS any secondary accounts synced just above — evaluateClientAdHealth
          // queries ad_daily_insights by client_id only, no account filter.
          // Non-fatal — a judging failure must not affect data collection.
          if (result.ad_daily?.success) {
            result.ad_health = await evaluateClientAdHealth(client.client_id, evaluationDate)

            // P21.K.4: email the day's digest (best-effort). Green is
            // de-frequenced so the PM isn't trained to ignore a daily 🟢.
            // Recipients come from per-client config (P21.K.5), else global inbox.
            // Skip sending when the config was a read-error fallback: enabled is
            // then a guess, and re-opening a paused client to email is the one
            // irreversible mistake we don't fail-open on (魏征).
            // ads IMPACT 阶段 1 第 7 步：快照表已建时改由下方（广告组级同步之后）的只读诊断发**内部版**日报；
            // 表还没建（migration 未 apply）→ 照旧在这里发原日报，行为不变。
            if (!snapshotsReady && adConfigSource !== 'fallback' && result.ad_health?.success && result.ad_health.overall_verdict) {
              const digest = await sendAdHealthDigest(
                client.client_id,
                client.client_name ?? 'Client',
                evaluationDate,
                resolveDigestRecipients(adStrategyConfig),
              )
              result.ad_digest = { sent: digest.sent, decision: digest.decision, error: digest.error }
            }
          }

          // P21.K.7: ad-level daily series, same table one level down. Runs
          // LAST on purpose — it is the biggest pull of the three (rows scale
          // with ads × days) and nothing above reads it, so a slow or failing
          // ad pull must not delay the health verdict or the digest that the
          // PM actually opens.
          result.ad_level = await syncAdDailyInsights(
            client.client_id,
            client.meta_ad_account_id,
            metaToken,
            { withVideo },
          )

          // ads IMPACT 阶段 1 §2.2：广告组级日数据（漏斗角色、ABO 预算都挂在广告组上）。
          // 同 ad_level 一样是 best-effort：不进 `failed`，失败进 errors。
          result.adset_level = isShared(client.meta_ad_account_id)
            ? skippedShared
            : await syncAdsetDailyInsights(client.client_id, client.meta_ad_account_id, metaToken, { withVideo })

          // ads IMPACT 阶段 1：只读诊断 + 内部版日报。放在广告组级同步之后（诊断要广告组级数据），
          // 且**不依赖**当天拉数/体检成功——授权断了导致拉数失败时，D7「授权/数据体检」正是要报这件事（子牙复审）。
          // 诊断出错：计入 errors；当天原体检成功的话退回发原日报，保证 PM 当天仍收得到信（魏征复审）。
          if (snapshotsReady && adConfigSource !== 'fallback') {
            result.ad_diagnostics = await runPortfolioDiagnostics(
              client.client_id,
              client.client_name ?? 'Client',
              evaluationDate,
              adStrategyConfig.digest_recipients,
            )
            if (!result.ad_diagnostics.success && result.ad_health?.success && result.ad_health.overall_verdict) {
              const digest = await sendAdHealthDigest(client.client_id, client.client_name ?? 'Client', evaluationDate, resolveDigestRecipients(adStrategyConfig))
              result.ad_digest = { sent: digest.sent, decision: `fallback:${digest.decision}`, error: digest.error }
            }
            // Ads D3 自动暂停：诊断成功就发事件，consumer 自己重查开关（是否
            // autonomy_mode）——事件只带 client_id/insight_date/diagnostic_run_id，
            // 不带诊断明细/客户名/具体数字（子牙复审）。best-effort：这一步失败
            // 不影响诊断和日报本身已经完成的事实，只丢一条 error 供排查。
            if (result.ad_diagnostics.success) {
              result.ad_auto_pause_event = await fireAdsDiagnosticsCompletedEvent(client.client_id, evaluationDate)
            }

            // 卫青巡察（spec 2026-09-24 §4）：问题 + 机会 + 目标节奏合成一行经营状态，
            // 看板和日报从那一行读。放在诊断之后：两边都要广告组级数据，顺序一致好排错。
            // 🔴 三层日数据的成败要**逐层**传进去——上面那个 `if (result.ad_daily?.success)`
            //    只看广告系列级，而机会规则大多是广告组粒度（`resolveCompleteness` 的变异用例钉着这条）。
            result.ads_growth_state = await buildGrowthState(client.client_id, evaluationDate, [
              { campaign: result.ad_daily, adset: result.adset_level, ad: result.ad_level },
              ...(result.ad_daily_secondary ?? []).map(s => ({
                campaign: s.ad_daily, adset: s.adset_level, ad: s.ad_level,
              })),
            ])
          }
        }

        // WP3.1a 每日 reconcile（spec 2026-09-25 §4.4）：不只靠 PATCH 的事件，每天对账一次，
        // 把 autonomy_mode 的意向同步进 Kernel 策略表。只对真有配置行的客户发；失败不进 failed。
        if (adConfigSource === 'row') {
          result.autonomy_sync = await reconcileAutonomyMode(supabaseAdmin, client.client_id).catch(
            (e: unknown) => ({ sent: false, events: 0, error: e instanceof Error ? e.message : String(e) }),
          )

          /**
           * A0 只读熔断探针（观察期，PM 2026-10-18 批「先走只读版」）。
           *
           * 放这道 `=== 'row'` 闸里面：没有配置行的客户不观察。
           * 探针自己还会再查一次 `autonomy_mode`，只对 `bounded_auto` 的客户出结论
           * （`observe` 的客户本来不会自动动手，给它们记结论只是噪音）。
           *
           * 🔴 **它不写任何表**，连 `ads_circuit_events` 都不写 —— 这一点由
           * `circuit-probe` 自己的测试扫源码钉住，不是靠这里的注释。
           * best-effort：探针失败不影响上面已经完成的拉数 / 诊断 / 巡察。
           */
          result.circuit_probe = await probeClientCircuit(supabaseAdmin, {
            clientId: client.client_id,
            autonomyMode: adStrategyConfig.autonomy_mode,
            now: probeNow,
          }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
        }
      } else {
        // Client has a Meta ad account but no usable token — surface it as a
        // failure (counted in `failed`, visible in `errors`) rather than
        // silently skipping the snapshot/ad_daily/health/digest chain for the
        // day. Distinguish the four ways this happens so an FDE reading
        // cron_run_logs doesn't have to guess: a genuine Render config gap
        // reads differently from "someone else owns this env key" or from a
        // transient DB read failure that will very likely clear on its own.
        result.meta = {
          success: false,
          error:
            resolved === 'ownership_unknown'
              ? 'meta token ownership check failed (transient client-row read error) — token withheld rather than risk using an unverified one'
              : legacyOwnershipUnknown
                ? 'legacy per-name Meta token ownership check failed (transient peer-scan error) — token withheld rather than risk using an unverified one'
                : legacyOwnershipDenied
                  ? 'legacy per-name Meta token is configured but this client does not own that name key'
                  : 'no Meta token configured for this client (no owned domain/Page token, no legacy per-name token, no shared fallback)',
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
  const metaSynced      = results.filter(r => r.meta?.success && !r.meta.skipped).length
  const metaIdle        = results.filter(r => r.meta?.skipped === 'no_active_ads').length
  const googleAdsSynced = results.filter(r => r.google_ads?.success).length
  const adDailySynced   = results.filter(r => r.ad_daily?.success).length
  const adDailyRows     = results.reduce((sum, r) => sum + (r.ad_daily?.rows_written ?? 0), 0)
  const adLevelSynced   = results.filter(r => r.ad_level?.success).length
  const adLevelRows     = results.reduce((sum, r) => sum + (r.ad_level?.rows_written ?? 0), 0)
  const adHealthSynced  = results.filter(r => r.ad_health?.success).length
  const adHealthAlerts  = results.filter(r => r.ad_health?.overall_verdict === 'alert').length
  const failed          = results.filter(
    r =>
      r.gsc?.success === false ||
      r.ga4?.success === false ||
      r.meta?.success === false ||
      r.google_ads?.success === false ||
      r.ad_daily?.success === false ||
      r.ad_health?.success === false ||
      r.ad_config?.success === false,
  ).length
  // ad_level is deliberately NOT in `failed`: this count drives
  // cron_run_logs.failed_count, which the daily-cron-digest emails on. The
  // ad-level pull is best-effort (nothing reads it yet, and it needs the
  // parent_id column), so a gap there must not train the PM to ignore cron
  // alerts. It still surfaces per-client in `errors` below.

  // Collect per-client errors so postmortem is possible without Render logs.
  // Diagnostic only — no behavior change.
  const errors = results.flatMap(r => {
    const out: Array<{ client_id: string; source: 'gsc'|'ga4'|'meta'|'google_ads'|'ad_daily'|'ad_level'|'adset_level'|'ad_health'|'ad_digest'|'ad_diagnostics'|'ads_growth_state'|'ad_daily_secondary'|'ad_config'|'circuit_probe'; error: string }> = []
    if (r.gsc?.success === false && r.gsc.error)               out.push({ client_id: r.client_id, source: 'gsc',        error: r.gsc.error })
    if (r.ga4?.success === false && r.ga4.error)               out.push({ client_id: r.client_id, source: 'ga4',        error: r.ga4.error })
    if (r.meta?.success === false && r.meta.error)             out.push({ client_id: r.client_id, source: 'meta',       error: r.meta.error })
    if (r.google_ads?.success === false && r.google_ads.error) out.push({ client_id: r.client_id, source: 'google_ads', error: r.google_ads.error })
    if (r.ad_daily?.success === false && r.ad_daily.error)     out.push({ client_id: r.client_id, source: 'ad_daily',   error: r.ad_daily.error })
    if (r.ad_level?.success === false && r.ad_level.error)     out.push({ client_id: r.client_id, source: 'ad_level',   error: r.ad_level.error })
    if (r.adset_level?.success === false && r.adset_level.error) out.push({ client_id: r.client_id, source: 'adset_level', error: r.adset_level.error })
    if (r.ad_health?.success === false && r.ad_health.error)   out.push({ client_id: r.client_id, source: 'ad_health', error: r.ad_health.error })
    if (r.ad_digest && !r.ad_digest.sent && r.ad_digest.error)  out.push({ client_id: r.client_id, source: 'ad_digest', error: r.ad_digest.error })
    if (r.ad_config?.success === false) out.push({ client_id: r.client_id, source: 'ad_config', error: r.ad_config.error })
    if (r.ad_diagnostics?.error) out.push({ client_id: r.client_id, source: 'ad_diagnostics', error: r.ad_diagnostics.error })
    if (r.ads_growth_state?.error) out.push({ client_id: r.client_id, source: 'ads_growth_state', error: r.ads_growth_state.error })
    // 2026-10-18（魏征复审）：探针的异常原先只落在 summary.circuit_probe 里，
    // 而那个键**没有任何代码在读** —— 它可以连抛十天，失败邮件写「0 failed」、
    // 待办一个字不提，等观察期结束有人手点开 jsonb 才发现十天全是 error。
    // 正是铁律 3 下半「发现不许死在日志里」要防的形状。
    // 跟 ad_level 一样 best-effort，不进 `failed`、不当邮件头条，但必须在这里出现。
    if (r.circuit_probe && 'error' in r.circuit_probe && r.circuit_probe.error) {
      out.push({ client_id: r.client_id, source: 'circuit_probe', error: r.circuit_probe.error })
    }
    // 2026-09-13 (魏征 review): a secondary account's sync failure used to be
    // completely invisible — not in `failed`, not here, not console.error'd —
    // the exact "looks fine, actually never worked" shape this whole PR is
    // trying to close, just one level down. Not counted in `failed`/the email
    // headline (best-effort like ad_level), but must show up in a manual read
    // of cron_run_logs instead of vanishing without a trace.
    for (const secondary of r.ad_daily_secondary ?? []) {
      if (secondary.ad_daily?.success === false && secondary.ad_daily.error) {
        out.push({ client_id: r.client_id, source: 'ad_daily_secondary', error: `[${secondary.ad_account_id}] ${secondary.ad_daily.error}` })
      }
      if (secondary.ad_level?.success === false && secondary.ad_level.error) {
        out.push({ client_id: r.client_id, source: 'ad_daily_secondary', error: `[${secondary.ad_account_id}] ${secondary.ad_level.error}` })
      }
      if (secondary.adset_level?.success === false && secondary.adset_level.error) {
        out.push({ client_id: r.client_id, source: 'ad_daily_secondary', error: `[${secondary.ad_account_id}] adset: ${secondary.adset_level.error}` })
      }
    }
    return out
  })

  // The failure email renders `error_message`, not the summary JSONB, so
  // without this the PM's alert reads "2 failed · —" and says nothing. Only the
  // errors that actually count as failures belong here — ad_level and
  // ad_daily_secondary are excluded (both best-effort, neither triggers `failed`)
  // and must not become the headline of an email they never triggered.
  // 配置读失败优先当头条：它一坏是所有客户的诊断一起停，而且以前正是被排在前面的
  // 常年 meta 报错盖住、没人注意到（2026-09-25 事故）。
  const headlineError =
    errors.find(e => e.source === 'ad_config') ??
    errors.find(e => e.source !== 'ad_level' && e.source !== 'adset_level' && e.source !== 'ad_daily_secondary' && e.source !== 'circuit_probe')
  const errorMessage = failed > 0 && headlineError
    ? `${headlineError.source}: ${headlineError.error}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`
    : undefined

  /**
   * A0 观察期的回执：只留有结论的（跳过的客户不占地方），落进 `cron_run_logs.summary`。
   * 观察期 7–10 天 = 7–10 行，够按天读；**不建新表**。
   */
  const circuitProbes = results
    .map((r) => r.circuit_probe)
    .filter((p): p is NonNullable<ClientProbe | { error: string }> => {
      if (!p) return false
      return 'error' in p || p.skipped === null
    })

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    error: errorMessage,
    failed,
    summary: { gsc_synced: gscSynced, ga4_synced: ga4Synced, meta_synced: metaSynced, meta_idle: metaIdle, google_ads_synced: googleAdsSynced, ad_daily_synced: adDailySynced, ad_daily_rows: adDailyRows, ad_level_synced: adLevelSynced, ad_level_rows: adLevelRows, ad_health_synced: adHealthSynced, ad_health_alerts: adHealthAlerts, video_columns_written: withVideo, errors, circuit_probe: circuitProbes },
  })
  return NextResponse.json({
    success:           true,
    clients_processed: results.length,
    gsc_synced:        gscSynced,
    ga4_synced:        ga4Synced,
    meta_synced:       metaSynced,
    meta_idle:         metaIdle,
    google_ads_synced: googleAdsSynced,
    ad_daily_synced:   adDailySynced,
    ad_daily_rows:     adDailyRows,
    ad_level_synced:   adLevelSynced,
    ad_level_rows:     adLevelRows,
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
): Promise<{ success: boolean; snapshot_id?: string; error?: string; skipped?: 'no_active_ads' }> {
  try {
    const today        = new Date()
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(today.getDate() - 30)
    const since = thirtyDaysAgo.toISOString().slice(0, 10)
    const until = today.toISOString().slice(0, 10)

    const [insightsResult, campaigns] = await Promise.all([
      getAdAccountInsightsResult(adAccountId, accessToken, since, until),
      getAdCampaignInsights(adAccountId, accessToken, since, until),
    ])

    if (!insightsResult.ok) {
      const failure = insightsResult.failure
      // Empty data array = account ran no ads in window, not an API error.
      if (failure.kind === 'no_delivery') return { success: true, skipped: 'no_active_ads' }
      const reason = failure.kind === 'http_error' ? `${failure.kind} (${failure.status})` : failure.kind
      return { success: false, error: `getAdAccountInsights ${reason}` }
    }
    const insights = insightsResult.insights

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

    // Objective-aware cost metrics. Deliberately NOT routed through
    // MetaAdsAdapter: it replays meta_ads_snapshots, whose columns stop at
    // roas/conversions, and adding columns is a schema change. These come
    // straight off the insights row we already hold. Non-fatal — the snapshot
    // is the pre-existing contract and must not regress if this write fails.
    await writeMetaObjectiveMetrics(clientId, adAccountId, insights, since, until)
      .catch(() => { /* non-fatal */ })

    // Append daily row to Airtable Meta Ads Daily table (non-fatal).
    await appendAirtableMetaDaily(clientSlug, adAccountId, insights, until).catch(() => {})

    return { success: true, snapshot_id: (data as { id: string }).id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Write the objective-dependent Meta cost metrics for one client.
 *
 * These are the metrics an account is actually judged on when it does not sell
 * anything: a click-to-Messenger lead-gen account has no purchase and no ROAS,
 * so before this existed its actions promised `ads.account.roas` and the
 * attribution job found nothing to compare, forever.
 *
 * The key list comes from the registry rather than being written out here, so
 * "the registry says meta_ads_pullback pulls this" and "meta_ads_pullback pulls
 * this" are one fact. Null values are SKIPPED, never stored as 0 — Meta not
 * reporting a cost-per-purchase for a Messenger campaign is an absence, and a
 * zero would read as "free conversions".
 */
async function writeMetaObjectiveMetrics(
  clientId:    string,
  adAccountId: string,
  insights:    MetaAdsInsights,
  since:       string,
  until:       string,
): Promise<void> {
  const valueByKey: Record<string, number | null> = {
    [ADS_METRIC_KEY.CPA]:                   insights.cpa,
    [ADS_METRIC_KEY.COST_PER_LEAD]:         insights.cost_per_lead,
    [ADS_METRIC_KEY.COST_PER_CONVERSATION]: insights.cost_per_conversation,
  }

  const measuredAt = new Date().toISOString()
  const today      = measuredAt.slice(0, 10)

  // Delete today's rows for THESE keys and THIS source only, so a cron retry
  // refreshes instead of stacking duplicates, and MetaAdsAdapter's own rows
  // (source 'meta_ads', different keys) are never touched.
  await supabaseAdmin
    .from('flywheel_metrics')
    .delete()
    .eq('client_id', clientId)
    .eq('source', 'meta_ads_pullback')
    .in('metric_key', adsMetricKeysWrittenBy('meta_ads_pullback'))
    .gte('measured_at', `${today}T00:00:00.000Z`)
    .lte('measured_at', `${today}T23:59:59.999Z`)
    .then(() => {}, () => {})

  const rows = adsMetricKeysWrittenBy('meta_ads_pullback')
    .filter(key => {
      if (!(key in valueByKey)) {
        // The registry promised this key and this function cannot produce it —
        // the exact drift the registry exists to prevent, so it must be noisy.
        console.error(`[cron] meta_ads_pullback registered for "${key}" but has no value source`)
        return false
      }
      return valueByKey[key] !== null
    })
    .map(key => ({
      client_id:    clientId,
      flywheel:     'ads' as const,
      metric_key:   key,
      metric_value: valueByKey[key],
      source:       'meta_ads_pullback',
      source_ref:   { ad_account_id: adAccountId, period_start: since, period_end: until },
      measured_at:  measuredAt,
    }))

  if (rows.length === 0) return

  const { error } = await supabaseAdmin.from('flywheel_metrics').insert(rows)
  if (error) {
    console.error('[cron] meta objective metrics insert failed:', error.message)
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
    // Derived from the registry, not hand-listed: the same map the write gate
    // reads, so a key can never be pulled here without being declared there.
    const adsMetricKeys = adsMetricKeysWrittenBy('google_ads_pullback')
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
