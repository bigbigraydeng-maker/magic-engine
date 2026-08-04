/**
 * Monthly Report Aggregator
 *
 * Pulls data from ai_visibility_snapshots, ai_visibility_runs, geo_directives,
 * and blog_posts to build a complete MonthlyReportData object.
 *
 * Reference: ROADMAP.md P7.4.1–P7.4.5, ARCHITECTURE.md §12, §13
 */

import { supabaseAdmin } from '../supabase'
import type { BrandMention } from '@/types/magic-engine'

// ── Output types ──────────────────────────────────────────────────────────────

export interface MonthlyOverview {
  this_month_avg_rank: number | null
  last_month_avg_rank: number | null
  /** positive = rank worsened, negative = rank improved */
  rank_change: number | null
  this_month_mentions: number
  last_month_mentions: number
  mention_change: number
  queries_tracked: number
  engines_used: string[]
}

export interface TrendPoint {
  week_of: string
  avg_rank: number | null
  mentions_count: number
}

export interface GeoDeploymentInfo {
  active_version: number | null
  directive_id: string | null
  deployed_pages: string[]
  deployed_pages_count: number
  published_blogs_this_month: number
}

export interface CompetitiveRow {
  question: string
  query_id: string
  client_rank: number | null
  competitors: Array<{ brand: string; rank: number }>
  engine: string
  run_at: string
}

// ── Phase 8 data types ────────────────────────────────────────────────────────

export interface LinkIntelligenceData {
  total_backlinks: number
  new_backlinks: number
  lost_backlinks: number
  referring_domains: number
  avg_domain_rank: number | null
  /** positive = growth vs last month */
  total_backlinks_delta: number | null
}

export interface SearchVisibilityData {
  tracked_keywords: number
  avg_rank: number | null
  top10_count: number
  top3_count: number
  improved_count: number
  top_movers: Array<{
    keyword: string
    url: string
    previous_rank: number | null
    current_rank: number | null
    delta: number | null
  }>
}

export interface LocalVisibilityData {
  total_cities: number
  cities: Array<{
    city: string
    avg_rank: number | null
    top3_count: number
    tracked_keywords: number
  }>
  top_opportunity_city: string | null
}

export interface MarketBenchmarkData {
  total_keywords_compared: number
  keywords_competitor_wins: number
  avg_gap: number | null
  top_opportunities: Array<{
    keyword: string
    client_rank: number | null
    competitor_rank: number | null
    competitor_domain: string
    opportunity_score: number
  }>
}

export interface DataSourceUsageData {
  total_cost_usd: number
  total_calls: number
  services: Array<{
    /** internal service key — UI must map via SERVICE_DISPLAY_MAP */
    service: string
    api_calls: number
    cost_usd: number
  }>
}

export interface MonthlyReportData {
  client_id: string
  client_name: string
  period_label: string   // e.g. "May 2026"
  period_from: string    // ISO date string
  period_to: string      // ISO date string
  overview: MonthlyOverview
  trend: TrendPoint[]    // 4 points, oldest → newest (for sparkline)
  geo: GeoDeploymentInfo
  competitive: CompetitiveRow[]
  // Phase 8 — null when table/data not yet available
  links: LinkIntelligenceData | null
  search: SearchVisibilityData | null
  local: LocalVisibilityData | null
  market: MarketBenchmarkData | null
  usage: DataSourceUsageData | null
  generated_at: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type SnapshotRow = {
  week_of: string
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  models_covered: string[] | null
}

function avgRank(snaps: SnapshotRow[]): number | null {
  const valid = snaps.filter(s => s.avg_rank != null)
  if (valid.length === 0) return null
  const sum = valid.reduce((acc, s) => acc + (s.avg_rank ?? 0), 0)
  return Math.round((sum / valid.length) * 10) / 10
}

function sumMentions(snaps: SnapshotRow[]): number {
  return snaps.reduce((acc, s) => acc + (s.mentions_count ?? 0), 0)
}

// ── Main aggregator ───────────────────────────────────────────────────────────

export async function buildMonthlyReport(clientId: string): Promise<MonthlyReportData> {
  const now = new Date()

  // Period boundaries
  const periodTo   = now.toISOString().split('T')[0]
  const periodFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastFrom   = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
  const lastTo     = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
  const periodLabel = now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

  // ── 1. Client name ─────────────────────────────────────────────────────────
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .single<{ name: string }>()

  const clientName = client?.name ?? 'Unknown Client'

  // ── 2. Snapshots (up to 8 weeks = 2 months) ────────────────────────────────
  const { data: snapsRaw } = await supabaseAdmin
    .from('ai_visibility_snapshots')
    .select('week_of, avg_rank, mentions_count, total_runs, models_covered')
    .eq('client_id', clientId)
    .order('week_of', { ascending: false })
    .limit(8)

  const snaps: SnapshotRow[] = (snapsRaw ?? []) as SnapshotRow[]

  const thisSnaps = snaps.filter(s => s.week_of >= periodFrom && s.week_of <= periodTo)
  const lastSnaps = snaps.filter(s => s.week_of >= lastFrom && s.week_of <= lastTo)

  // Fallback: if no month-scoped snaps, use latest 4 vs prior 4
  const thisUsed = thisSnaps.length > 0 ? thisSnaps : snaps.slice(0, 4)
  const lastUsed = lastSnaps.length > 0 ? lastSnaps : snaps.slice(4, 8)

  const thisAvg = avgRank(thisUsed)
  const lastAvg = avgRank(lastUsed)
  const rankChange =
    thisAvg != null && lastAvg != null
      ? Math.round((thisAvg - lastAvg) * 10) / 10
      : null

  const thisMentions = sumMentions(thisUsed)
  const lastMentions = sumMentions(lastUsed)

  const engines = Array.from(new Set(snaps.flatMap(s => s.models_covered ?? [])))

  // ── 3. Queries tracked ─────────────────────────────────────────────────────
  const { count: queriesCount } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('enabled', true)

  // ── 4. Trend (4 points, oldest first for chart left→right) ────────────────
  const trendSnaps = snaps.slice(0, 4).reverse()
  const trend: TrendPoint[] = trendSnaps.map(s => ({
    week_of:       s.week_of,
    avg_rank:      s.avg_rank,
    mentions_count: s.mentions_count,
  }))

  // ── 5. GEO directive ───────────────────────────────────────────────────────
  const { data: geo } = await supabaseAdmin
    .from('geo_directives')
    .select('id, version, deployed_pages')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle<{ id: string; version: number; deployed_pages: string[] }>()

  const { count: publishedBlogs } = await supabaseAdmin
    .from('blog_posts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'published')
    .gte('published_at', periodFrom)

  // ── 6. Competitive comparison ──────────────────────────────────────────────
  const { data: queries } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question')
    .eq('client_id', clientId)
    .eq('enabled', true)
    .order('created_at', { ascending: true })
    .limit(10)

  const competitive: CompetitiveRow[] = []

  if (queries && queries.length > 0) {
    const queryIds = queries.map((q: { id: string }) => q.id)
    const questionMap = new Map<string, string>(
      queries.map((q: { id: string; question: string }) => [q.id, q.question])
    )

    const { data: runs } = await supabaseAdmin
      .from('ai_visibility_runs')
      .select('query_id, ai_engine, client_brand_rank, brands_mentioned, ran_at')
      .eq('client_id', clientId)
      .in('query_id', queryIds)
      .order('ran_at', { ascending: false })
      .limit(queryIds.length * 4)

    const seenQueries = new Set<string>()

    for (const run of (runs ?? []) as Array<{
      query_id: string
      ai_engine: string
      client_brand_rank: number | null
      brands_mentioned: BrandMention[] | null
      ran_at: string
    }>) {
      if (seenQueries.has(run.query_id)) continue
      seenQueries.add(run.query_id)

      const competitors = (run.brands_mentioned ?? [])
        .filter(b => b.brand && b.rank != null)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 5)
        .map(b => ({ brand: b.brand, rank: b.rank }))

      competitive.push({
        question:    questionMap.get(run.query_id) ?? '',
        query_id:    run.query_id,
        client_rank: run.client_brand_rank,
        competitors,
        engine:      run.ai_engine,
        run_at:      run.ran_at,
      })
    }

    // Fill in queries with no runs (show as unknown)
    for (const q of queries as Array<{ id: string; question: string }>) {
      if (!seenQueries.has(q.id)) {
        competitive.push({
          question:    q.question,
          query_id:    q.id,
          client_rank: null,
          competitors: [],
          engine:      '—',
          run_at:      '',
        })
      }
    }
  }

  // ── Assemble base (Phase 7) ───────────────────────────────────────────────
  const base: MonthlyReportData = {
    client_id:    clientId,
    client_name:  clientName,
    period_label: periodLabel,
    period_from:  periodFrom,
    period_to:    periodTo,
    overview: {
      this_month_avg_rank:  thisAvg,
      last_month_avg_rank:  lastAvg,
      rank_change:          rankChange,
      this_month_mentions:  thisMentions,
      last_month_mentions:  lastMentions,
      mention_change:       thisMentions - lastMentions,
      queries_tracked:      queriesCount ?? 0,
      engines_used:         engines,
    },
    trend,
    geo: {
      active_version:           geo?.version ?? null,
      directive_id:             geo?.id ?? null,
      deployed_pages:           geo?.deployed_pages ?? [],
      deployed_pages_count:     (geo?.deployed_pages ?? []).length,
      published_blogs_this_month: publishedBlogs ?? 0,
    },
    competitive,
    generated_at: now.toISOString(),
    // Phase 8 collectors resolved in parallel below
    links: null,
    search: null,
    local: null,
    market: null,
    usage: null,
  }

  // ── Phase 8 parallel collectors (gracefully degrade if table absent) ─────────
  const [linksResult, searchResult, localResult, marketResult, usageResult] =
    await Promise.allSettled([
      collectLinkIntelligence(clientId, periodFrom, periodTo, lastFrom, lastTo),
      collectSearchVisibility(clientId),
      collectLocalVisibility(clientId),
      collectMarketBenchmark(clientId),
      collectDataSourceUsage(clientId, now),
    ])

  if (linksResult.status  === 'fulfilled') base.links  = linksResult.value
  if (searchResult.status === 'fulfilled') base.search = searchResult.value
  if (localResult.status  === 'fulfilled') base.local  = localResult.value
  if (marketResult.status === 'fulfilled') base.market = marketResult.value
  if (usageResult.status  === 'fulfilled') base.usage  = usageResult.value

  return base
}

// ── Phase 8 Collector: Link Intelligence ─────────────────────────────────────

async function collectLinkIntelligence(
  clientId: string,
  periodFrom: string,
  _periodTo: string,
  lastFrom: string,
  _lastTo: string,
): Promise<LinkIntelligenceData | null> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('backlink_velocity')
      .select('snapshot_date, total_backlinks, new_backlinks, lost_backlinks, referring_domains_count, avg_domain_rank')
      .eq('client_id', clientId)
      .order('snapshot_date', { ascending: false })
      .limit(8)

    if (error || !rows || rows.length === 0) return null

    type VelocityRow = typeof rows[number]
    const thisMonth = rows.filter((r: VelocityRow) => r.snapshot_date >= periodFrom)
    const lastMonth = rows.filter((r: VelocityRow) => r.snapshot_date >= lastFrom && r.snapshot_date < periodFrom)

    const latest = thisMonth[0] ?? rows[0]
    const lastLatest = lastMonth[0] ?? null

    const totalDelta = lastLatest
      ? (latest.total_backlinks ?? 0) - (lastLatest.total_backlinks ?? 0)
      : null

    return {
      total_backlinks:       latest.total_backlinks ?? 0,
      new_backlinks:         thisMonth.reduce((a: number, r: VelocityRow) => a + (r.new_backlinks ?? 0), 0),
      lost_backlinks:        thisMonth.reduce((a: number, r: VelocityRow) => a + (r.lost_backlinks ?? 0), 0),
      referring_domains:     latest.referring_domains_count ?? 0,
      avg_domain_rank:       latest.avg_domain_rank ?? null,
      total_backlinks_delta: totalDelta,
    }
  } catch {
    return null
  }
}

// ── Phase 8 Collector: Search Visibility (SERP) ───────────────────────────────

async function collectSearchVisibility(clientId: string): Promise<SearchVisibilityData | null> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('serp_rankings')
      .select('keyword, url, current_rank, previous_rank')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })

    if (error || !rows || rows.length === 0) return null

    type SerpRow = typeof rows[number]
    const tracked = rows.length
    const ranked  = rows.filter((r: SerpRow) => r.current_rank != null)
    const avgRank = ranked.length
      ? Math.round(ranked.reduce((a: number, r: SerpRow) => a + (r.current_rank ?? 0), 0) / ranked.length * 10) / 10
      : null

    const improved = rows.filter((r: SerpRow) =>
      r.current_rank != null && r.previous_rank != null && r.current_rank < r.previous_rank
    )

    const topMovers = rows
      .filter((r: SerpRow) => r.previous_rank != null && r.current_rank != null)
      .map((r: SerpRow) => ({
        keyword:       r.keyword as string,
        url:           (r.url ?? '') as string,
        previous_rank: r.previous_rank as number | null,
        current_rank:  r.current_rank as number | null,
        delta:         (r.previous_rank ?? 0) - (r.current_rank ?? 0),
      }))
      .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
      .slice(0, 5)

    return {
      tracked_keywords: tracked,
      avg_rank:         avgRank,
      top10_count:      rows.filter((r: SerpRow) => r.current_rank != null && r.current_rank <= 10).length,
      top3_count:       rows.filter((r: SerpRow) => r.current_rank != null && r.current_rank <= 3).length,
      improved_count:   improved.length,
      top_movers:       topMovers,
    }
  } catch {
    return null
  }
}

// ── Phase 8 Collector: Local Visibility ──────────────────────────────────────

async function collectLocalVisibility(clientId: string): Promise<LocalVisibilityData | null> {
  // 主读 keyword_snapshots.local_pack_rank（每周 SERP 采集写入，DataForSEO
  // 计划 阶段 1）。旧 local_serp_rankings 只剩 8 行死数据，留作 fallback。
  const fromSnapshots = await collectLocalVisibilityFromSnapshots(clientId)
  if (fromSnapshots) return fromSnapshots

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('local_serp_rankings')
      .select('keyword, city, current_rank, previous_rank')
      .eq('client_id', clientId)

    if (error || !rows || rows.length === 0) return null

    type LocalRow = typeof rows[number]
    const cityMap = new Map<string, { ranks: number[]; top3: number; count: number }>()

    for (const r of rows as LocalRow[]) {
      const city = r.city as string
      if (!cityMap.has(city)) cityMap.set(city, { ranks: [], top3: 0, count: 0 })
      const entry = cityMap.get(city)!
      entry.count++
      if (r.current_rank != null) {
        entry.ranks.push(r.current_rank as number)
        if ((r.current_rank as number) <= 3) entry.top3++
      }
    }

    const cities = Array.from(cityMap.entries())
      .map(([city, { ranks, top3, count }]) => ({
        city,
        avg_rank:         ranks.length ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length * 10) / 10 : null,
        top3_count:       top3,
        tracked_keywords: count,
      }))
      .sort((a, b) => (a.avg_rank ?? 999) - (b.avg_rank ?? 999))

    // Opportunity = worst avg_rank with enough tracked keywords
    const opportunity = cities
      .filter(c => c.tracked_keywords >= 3 && c.avg_rank != null)
      .sort((a, b) => (b.avg_rank ?? 0) - (a.avg_rank ?? 0))[0] ?? null

    return {
      total_cities:          cities.length,
      cities:                cities.slice(0, 8),
      top_opportunity_city:  opportunity?.city ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Local visibility from the weekly SERP capture: latest snapshot's
 * local_pack_rank column. keyword_snapshots is country-level (no city
 * dimension), so the report gets ONE bucket labelled by market.
 */
async function collectLocalVisibilityFromSnapshots(
  clientId: string,
): Promise<LocalVisibilityData | null> {
  try {
    // Latest snapshot date that actually carries local pack data.
    const { data: latestRow } = await supabaseAdmin
      .from('keyword_snapshots')
      .select('snapshot_date, semrush_db')
      .eq('client_id', clientId)
      .not('local_pack_rank', 'is', null)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    const latest = latestRow as { snapshot_date: string; semrush_db: string | null } | null
    if (!latest) return null

    // 时效闸：采集断掉后不能把陈年 local pack 数据当当期展示（月报按月出，
    // 放宽到 35 天覆盖月初出上月报的场景）。过期就走 fallback。
    const ageMs = Date.now() - new Date(`${latest.snapshot_date}T00:00:00Z`).getTime()
    if (ageMs > 35 * 24 * 60 * 60 * 1000) return null

    const { data: rows, error } = await supabaseAdmin
      .from('keyword_snapshots')
      .select('keyword, local_pack_rank')
      .eq('client_id', clientId)
      .eq('snapshot_date', latest.snapshot_date)

    if (error || !rows || rows.length === 0) return null

    type SnapRow = { keyword: string; local_pack_rank: number | null }
    const inPack = (rows as SnapRow[]).filter(r => r.local_pack_rank != null)
    if (inPack.length === 0) return null

    const ranks = inPack.map(r => r.local_pack_rank as number)
    const market = latest.semrush_db === 'nz' ? 'New Zealand' : 'Australia'

    return {
      total_cities: 1,
      cities: [{
        city:             market,
        avg_rank:         Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length * 10) / 10,
        top3_count:       inPack.length, // local pack 本身就是前 3
        tracked_keywords: rows.length,
      }],
      top_opportunity_city: null,
    }
  } catch {
    return null
  }
}

// ── Phase 8 Collector: Market Benchmark ──────────────────────────────────────

async function collectMarketBenchmark(clientId: string): Promise<MarketBenchmarkData | null> {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('market_comparison')
      .select('keyword, client_rank, competitor_rank, competitor_domain, opportunity_score')
      .eq('client_id', clientId)
      .order('opportunity_score', { ascending: false })
      .limit(50)

    if (error || !rows || rows.length === 0) return null

    type MktRow = typeof rows[number]
    const competitorWins = rows.filter(
      (r: MktRow) => r.competitor_rank != null && r.client_rank != null && (r.competitor_rank as number) < (r.client_rank as number)
    ).length

    const gapped = rows.filter((r: MktRow) => r.client_rank != null && r.competitor_rank != null)
    const avgGap = gapped.length
      ? Math.round(gapped.reduce((a: number, r: MktRow) => a + ((r.client_rank as number) - (r.competitor_rank as number)), 0) / gapped.length * 10) / 10
      : null

    return {
      total_keywords_compared:  rows.length,
      keywords_competitor_wins: competitorWins,
      avg_gap:                  avgGap,
      top_opportunities:        rows.slice(0, 5).map((r: MktRow) => ({
        keyword:          r.keyword as string,
        client_rank:      r.client_rank as number | null,
        competitor_rank:  r.competitor_rank as number | null,
        competitor_domain: r.competitor_domain as string,
        opportunity_score: r.opportunity_score as number,
      })),
    }
  } catch {
    return null
  }
}

// ── Phase 8 Collector: Data Source Usage ─────────────────────────────────────

async function collectDataSourceUsage(
  clientId: string,
  now: Date,
): Promise<DataSourceUsageData | null> {
  try {
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const { data: rows, error } = await supabaseAdmin
      .from('datasource_usage_logs')
      .select('service, api_calls, cost_usd')
      .eq('client_id', clientId)
      .eq('month', month)

    if (error || !rows || rows.length === 0) return null

    type UsageRow = typeof rows[number]
    // Client-side aggregate by service (PostgREST doesn't support GROUP BY natively)
    const svcMap = new Map<string, { calls: number; cost: number }>()
    for (const r of rows as UsageRow[]) {
      const svc = r.service as string
      if (!svcMap.has(svc)) svcMap.set(svc, { calls: 0, cost: 0 })
      const entry = svcMap.get(svc)!
      entry.calls += (r.api_calls as number) ?? 0
      entry.cost  += (r.cost_usd as number) ?? 0
    }

    const services = Array.from(svcMap.entries())
      .map(([service, { calls, cost }]) => ({ service, api_calls: calls, cost_usd: cost }))
      .sort((a, b) => b.cost_usd - a.cost_usd)

    return {
      total_cost_usd: Math.round(services.reduce((a, s) => a + s.cost_usd, 0) * 10000) / 10000,
      total_calls:    services.reduce((a, s) => a + s.api_calls, 0),
      services,
    }
  } catch {
    return null
  }
}
