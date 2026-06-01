'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  MePanel,
  MePanelHeader,
  MePill,
  MeTrend,
  MeButton,
  MeChip,
  MeMeter,
  MeTable,
  MeTh,
  MeTd,
  MeTr,
} from '@/components/ui/me-primitives';
import { GOLD_GRADIENT } from '@/components/ui/me-theme';
import { TrendSparkline } from './_components/TrendSparkline';
<<<<<<< HEAD
import { SectionHeader } from './_components/Shared';
import { LinkIntelligencePanel } from './_components/LinkIntelligencePanel';
import { SearchVisibilityPanel } from './_components/SearchVisibilityPanel';
import { LocalVisibilityPanel } from './_components/LocalVisibilityPanel';
import { MarketBenchmarkPanel } from './_components/MarketBenchmarkPanel';
import { DataSourceUsagePanel } from './_components/DataSourceUsagePanel';
import {
  MePanel, MeStatCard, MePill, MeTrend, MeButton, MeChip,
} from '@/components/ui/me-primitives';
import { GOLD_GRADIENT } from '@/components/ui/me-theme';
import type { MonthlyReportData } from '@/lib/reports/monthly-aggregator';
=======
import { buildExportHtml } from './_components/exportHtml';
import type {
  MonthlyReportData,
  TrendPoint,
  DataSourceUsageData,
} from '@/lib/reports/monthly-aggregator';
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)

/**
 * /dashboard/reports/[clientId]/monthly
 *
 * Monthly Insight Report — search, AI, local, links and benchmarks.
 *
 * Matches `view-reports` in the Magic Engine design system:
 *   – Topbar with breadcrumb + period chips + Download HTML
 *   – Hero panel with 4-up `rsum`
 *   – grid-2 of `rpanel` cards (Search / AI / Local / Market / Links / Usage)
 *   – Plus legacy detail sections: GEO deployment, competitive comparison,
 *     top movers, top opportunities, Strategy Engine recommendations.
 *
 * All data queries (datasource_monthly_reports, flywheel_metrics, etc.) are
 * preserved through `/api/reports/[clientId]/monthly`.
 *
 * Reference: ROADMAP.md P7.4.1–P7.4.7
 */
export default function MonthlyReportPage() {
  const params = useParams();
  const clientId = params.clientId as string;

  const [report, setReport] = useState<MonthlyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Recommendations
  const [recs, setRecs] = useState('');
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsCost, setRecsCost] = useState<number | null>(null);
  const [recsError, setRecsError] = useState('');

  // Export
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/reports/${clientId}/monthly`);
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Failed to load report');
      setReport(j.report);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading report');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleGenerateRecs = async () => {
    setRecsLoading(true);
    setRecsError('');
    try {
      const res = await fetch(`/api/reports/${clientId}/monthly/recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Generation failed');
      setRecs(j.recommendations);
      setRecsCost(j.cost_usd ?? null);
    } catch (err: unknown) {
      setRecsError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setRecsLoading(false);
    }
  };

  const handleExport = () => {
    if (!report) return;
    setExporting(true);
    try {
      const html = buildExportHtml(report, recs);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.client_name.replace(/\s+/g, '-')}-Monthly-Report-${report.period_label.replace(/\s+/g, '-')}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
<<<<<<< HEAD
      <div className="space-y-4 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded-[14px] bg-[#EAE6DF]" />
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-[110px] rounded-[24px] bg-[#EAE6DF]" />)}
          </div>
          <div className="h-[160px] rounded-[24px] bg-[#EAE6DF]" />
          <div className="grid grid-cols-2 gap-4">
            {[1,2,3,4,5,6].map(i => <div key={i} className="h-[160px] rounded-[24px] bg-[#EAE6DF]" />)}
=======
      <div className="font-sans">
        <div className="sticky top-0 z-20 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
          <div className="h-7 w-64 animate-pulse rounded bg-me-stone" />
        </div>
        <div className="space-y-6 px-8 py-7">
          <div className="h-44 animate-pulse rounded-[24px] bg-white shadow-card" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-44 animate-pulse rounded-[24px] bg-white shadow-card" />
            ))}
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
          </div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
<<<<<<< HEAD
      <div className="p-6">
        <MePanel>
          <p className="text-sm text-[#C2453A]">{error || 'Report not found.'}</p>
          <button onClick={fetchReport} className="mt-2 text-sm font-semibold text-[#C4912E] hover:underline">
=======
      <div className="font-sans px-8 py-7">
        <MePanel>
          <p className="text-sm font-semibold text-[#C2453A]">{error || 'Report not found.'}</p>
          <button
            onClick={fetchReport}
            className="mt-2 text-sm font-semibold text-me-ochre hover:underline"
          >
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
            Retry
          </button>
        </MePanel>
      </div>
    );
  }

  const { overview, trend, geo, competitive, links, search, local, market, usage } = report;

<<<<<<< HEAD
  const rankDir: 'up' | 'down' | 'flat' = overview.rank_change != null
    ? overview.rank_change < 0 ? 'up' : overview.rank_change > 0 ? 'down' : 'flat'
    : 'flat';

  const mentionDir: 'up' | 'down' | 'flat' = overview.mention_change > 0 ? 'up'
    : overview.mention_change < 0 ? 'down' : 'flat';

  return (
    <div className="space-y-6 p-6">
      {/* ── Header / toolbar ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {/* breadcrumb */}
          <div className="mb-1 flex items-center gap-1.5 text-[12px] text-black/40">
            <Link href="/dashboard/reports" className="hover:text-[#C4912E]">Reports</Link>
            <span>/</span>
            <span>{report.client_name}</span>
            <span>/</span>
            <span className="text-[#C4912E]">Monthly</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#1A1A1A]">
            Monthly Insight Report · {report.period_label}
          </h1>
          <p className="mt-1 text-sm text-black/60">
            {report.client_name} · generated from every battlefront
          </p>
        </div>
        <div className="flex gap-2">
          <MeButton variant="ghost" size="sm">Send to client</MeButton>
          <MeButton
            variant="primary"
            size="sm"
            disabled={exporting}
            onClick={handleExport}
          >
            {exporting ? '…' : 'Download PDF'}
          </MeButton>
        </div>
      </div>

      {/* ── Hero panel: 4-up summary (rsum) ──────────────────────────── */}
      <MePanel>
        {/* title + status pill */}
        <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="font-display text-lg font-semibold text-[#1A1A1A]">
              Monthly Insight Report · {report.period_label}
            </p>
            <p className="mt-0.5 text-[13px] text-black/60">
              {report.client_name} · generated from every battlefront
            </p>
          </div>
          <MePill tone="track">On track</MePill>
        </div>

        {/* rsum: 4 hero stats */}
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {/* AI visibility */}
          <div>
            <div
              className="font-display text-[28px] font-bold leading-none"
              style={{ backgroundImage: GOLD_GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            >
              {overview.rank_change != null && overview.rank_change < 0
                ? `+${Math.abs(overview.rank_change)}%`
                : overview.this_month_avg_rank != null
                ? `#${overview.this_month_avg_rank}`
                : '—'}
            </div>
            <div className="mt-1 text-[12.5px] text-black/60">AI visibility</div>
          </div>

          {/* Actions shipped / mentions */}
          <div>
            <div className="font-display text-[28px] font-bold leading-none text-[#1A1A1A]">
              {overview.this_month_mentions}
            </div>
            <div className="mt-1 text-[12.5px] text-black/60">Actions shipped</div>
          </div>

          {/* Top-10 keywords */}
          <div>
            <div className="font-display text-[28px] font-bold leading-none text-[#1A1A1A]">
              {overview.queries_tracked}
            </div>
            <div className="mt-1 text-[12.5px] text-black/60">Top-10 keywords</div>
          </div>

          {/* Content published (blogs) */}
          <div>
            <div className="font-display text-[28px] font-bold leading-none text-[#1A1A1A]">
              {geo.published_blogs_this_month}
            </div>
            <div className="mt-1 text-[12.5px] text-black/60">Content published</div>
          </div>
        </div>
      </MePanel>

      {/* ── §1 AI Visibility KPI cards ────────────────────────────────── */}
      <section>
        <SectionHeader number="1" title="AI Visibility Overview" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MeStatCard
            tone="ochre"
            goldValue
            value={overview.this_month_avg_rank != null ? `#${overview.this_month_avg_rank}` : '—'}
            label="Avg AI Rank"
            footer={
              overview.rank_change != null
                ? <MeTrend dir={rankDir}>{Math.abs(overview.rank_change)} vs last month</MeTrend>
                : <span className="text-xs text-black/30">No prior data</span>
            }
          />
          <MeStatCard
            tone="track"
            value={overview.this_month_mentions.toString()}
            label="AI Mentions"
            footer={
              <MeTrend dir={mentionDir}>{Math.abs(overview.mention_change)} vs last month</MeTrend>
            }
          />
          <MeStatCard
            tone="stone"
            value={overview.queries_tracked.toString()}
            label="Queries Tracked"
            footer={<span className="text-xs text-black/40">active queries</span>}
          />
          <MeStatCard
            tone="stone"
            value={overview.engines_used.length.toString()}
            label="AI Engines"
            footer={
              <span className="truncate text-xs text-black/40">
                {overview.engines_used.join(', ') || 'none yet'}
              </span>
            }
          />
=======
  // ── Hero summary derivations ─────────────────────────────────────────────
  const overallTrendDir: 'up' | 'down' | 'flat' =
    overview.rank_change == null
      ? 'flat'
      : overview.rank_change < 0
        ? 'up'
        : overview.rank_change > 0
          ? 'down'
          : 'flat';

  const overallPillTone =
    overallTrendDir === 'up' ? 'track' : overallTrendDir === 'down' ? 'rej' : 'exec';
  const overallPillLabel =
    overallTrendDir === 'up' ? 'On track' : overallTrendDir === 'down' ? 'Needs attention' : 'Stable';

  // Hero 4-up `rsum` values
  const heroStats: Array<{ value: string; label: string; gold?: boolean }> = [
    {
      value: overview.this_month_avg_rank != null ? `#${overview.this_month_avg_rank}` : '—',
      label: 'Avg AI rank',
      gold: true,
    },
    {
      value: overview.this_month_mentions.toLocaleString(),
      label: 'AI mentions',
    },
    {
      value: overview.queries_tracked.toLocaleString(),
      label: 'Queries tracked',
    },
    {
      value: geo.published_blogs_this_month.toLocaleString(),
      label: 'Content published',
    },
  ];

  // Mention rate (percentage form) for the AI visibility big stat
  const mentionRatePercent =
    overview.queries_tracked > 0
      ? Math.round((overview.this_month_mentions / Math.max(overview.queries_tracked, 1)) * 100)
      : null;

  // Sparkline polyline points (300×42) from snapshot trend data
  const sparkPoints = buildSparkPoints(trend);
  const sparkRankPoints = buildSparkRankPoints(trend);

  // Mention WoW direction
  const mentionTrendDir: 'up' | 'down' | 'flat' =
    overview.mention_change > 0 ? 'up' : overview.mention_change < 0 ? 'down' : 'flat';

  return (
    <div className="font-sans">
      {/* Topbar — matches design view-reports toolbar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] text-black/45">
            <Link href="/dashboard/clients" className="hover:text-black/70">Clients</Link>
            <span className="text-black/25">/</span>
            <Link href="/dashboard/reports" className="hover:text-black/70">Reports</Link>
            <span className="text-black/25">/</span>
            <span className="truncate text-black/55">{report.client_name}</span>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">
            Reports
          </h1>
          <p className="mt-[3px] text-[13px] text-black/55">
            Monthly Insight Report — search, AI, local, links and benchmarks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MeChip>{report.client_name}</MeChip>
          <MeChip>{report.period_label}</MeChip>
          <MeButton variant="ghost" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Download HTML'}
          </MeButton>
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
        </div>
      </header>

<<<<<<< HEAD
      {/* ── §2 4-week Trend sparkline ─────────────────────────────────── */}
      <section>
        <SectionHeader number="2" title="4-Week Ranking Trend" />
        <MePanel>
          {trend.length < 2 ? (
            <p className="py-6 text-center text-sm text-black/40">
              Not enough data yet — run the AI Visibility Tracker for at least 2 weeks.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-[12.5px] text-black/60">
                Average AI rank across all queries (lower = better).
              </p>
              <TrendSparkline data={trend} width={600} height={110} />
              <div className="flex gap-6 mt-2">
                {trend.map((pt, i) => (
                  <div key={i} className="text-center">
                    <p className="font-display text-xs text-black/40">{pt.week_of.slice(5)}</p>
                    <p className="font-display text-sm font-bold text-[#1A1A1A]">
                      {pt.avg_rank != null ? `#${pt.avg_rank}` : '—'}
                    </p>
                    <p className="text-xs text-black/40">{pt.mentions_count} mentions</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </MePanel>
      </section>

      {/* ── §3 GEO Deployment ────────────────────────────────────────── */}
      <section>
        <SectionHeader number="3" title="GEO Deployment" />
        <MePanel>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <p className="font-display text-[28px] font-bold text-[#C4912E]">
                {geo.active_version != null ? `v${geo.active_version}` : '—'}
              </p>
              <p className="mt-1 text-[12.5px] text-black/60">Active GEO Version</p>
            </div>
            <div className="text-center">
              <p className="font-display text-[28px] font-bold text-[#1A1A1A]">
                {geo.deployed_pages_count}
              </p>
              <p className="mt-1 text-[12.5px] text-black/60">Pages with Snippet</p>
            </div>
            <div className="text-center">
              <p className="font-display text-[28px] font-bold text-[#1A1A1A]">
                {geo.published_blogs_this_month}
              </p>
              <p className="mt-1 text-[12.5px] text-black/60">Blogs Published (this month)</p>
            </div>
          </div>

          {geo.deployed_pages.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Deployed URLs</p>
              <ul className="space-y-1">
                {geo.deployed_pages.map((url, i) => (
                  <li key={i} className="rounded-[10px] bg-[#FBF8F3] px-3 py-1.5 text-xs font-mono text-[#1A1A1A]">
=======
      <div className="space-y-6 px-8 py-7 max-w-6xl">
        {/* ── Hero panel: title + status pill + 4-up rsum ─────────────────── */}
        <MePanel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight text-me-charcoal">
                Monthly Insight Report · {report.period_label}
              </h2>
              <p className="mt-[3px] text-[13px] text-black/55">
                {report.client_name} · generated from every battlefront
                <span className="ml-1 text-black/30">
                  · {report.period_from} → {report.period_to}
                </span>
              </p>
            </div>
            <MePill tone={overallPillTone}>{overallPillLabel}</MePill>
          </div>

          {/* `rsum` — 4-up summary */}
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {heroStats.map((s, i) => (
              <div key={i}>
                <div
                  className={`font-display text-[28px] font-bold leading-none ${
                    s.gold ? 'bg-clip-text text-transparent' : 'text-me-charcoal'
                  }`}
                  style={s.gold ? { backgroundImage: GOLD_GRADIENT } : undefined}
                >
                  {s.value}
                </div>
                <div className="mt-[5px] text-[12.5px] text-black/60">{s.label}</div>
              </div>
            ))}
          </div>
        </MePanel>

        {/* ── grid-2 of rpanel cards ─────────────────────────────────────── */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Search visibility */}
          <MePanel>
            <PanelHead title="Search visibility">
              {search && search.improved_count > 0 ? (
                <MeTrend dir="up">{search.improved_count}</MeTrend>
              ) : (
                <MeChip>{search ? `${search.tracked_keywords} kw` : 'No data'}</MeChip>
              )}
            </PanelHead>
            <BigStat
              value={search?.tracked_keywords?.toLocaleString() ?? '—'}
              caption="tracked keywords this month"
            />
            <SparkLine points={sparkPoints} />
            <div className="mt-2 grid grid-cols-3 gap-3">
              <Mini label="Avg rank" value={search?.avg_rank != null ? `#${search.avg_rank}` : '—'} />
              <Mini label="Top 10" value={search ? search.top10_count.toString() : '—'} />
              <Mini label="Top 3" value={search ? search.top3_count.toString() : '—'} />
            </div>
          </MePanel>

          {/* AI visibility */}
          <MePanel>
            <PanelHead title="AI visibility">
              {overview.mention_change !== 0 ? (
                <MeTrend dir={mentionTrendDir}>{Math.abs(overview.mention_change)}</MeTrend>
              ) : (
                <MeChip>flat</MeChip>
              )}
            </PanelHead>
            <BigStat
              value={mentionRatePercent != null ? `${mentionRatePercent}%` : '—'}
              caption={
                overview.engines_used.length > 0
                  ? `share across ${overview.engines_used.join(' · ')}`
                  : 'share across AI engines'
              }
              gold
            />
            <SparkLine points={sparkRankPoints} />
            <div className="mt-2 grid grid-cols-3 gap-3">
              <Mini
                label="Avg rank"
                value={overview.this_month_avg_rank != null ? `#${overview.this_month_avg_rank}` : '—'}
              />
              <Mini label="Mentions" value={overview.this_month_mentions.toLocaleString()} />
              <Mini label="Engines" value={overview.engines_used.length.toString()} />
            </div>
          </MePanel>

          {/* Local visibility */}
          <MePanel>
            <PanelHead title="Local visibility">
              {local && local.total_cities > 0 ? (
                <MeChip gold>
                  {local.total_cities} {local.total_cities === 1 ? 'city' : 'cities'}
                </MeChip>
              ) : (
                <MeChip>No data</MeChip>
              )}
            </PanelHead>
            {local ? (
              <div className="space-y-[10px]">
                {local.cities.slice(0, 3).map((c, i) => (
                  <RRow
                    key={i}
                    label={c.city}
                    value={c.avg_rank != null ? `#${c.avg_rank}` : '—'}
                  />
                ))}
                {local.cities.length === 0 && (
                  <p className="py-2 text-center text-[13px] text-black/45">
                    No city-level rank data yet.
                  </p>
                )}
                {local.top_opportunity_city && (
                  <div className="mt-3 rounded-xl border border-me-ochre/30 bg-me-ochre/10 px-3.5 py-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-[.1em] text-me-ochre">
                      Top opportunity
                    </p>
                    <p className="mt-0.5 text-[14px] font-semibold text-me-ochre">
                      {local.top_opportunity_city}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <EmptyHint message="Local search data not yet available." />
            )}
          </MePanel>

          {/* Market benchmark */}
          <MePanel>
            <PanelHead title="Market benchmark">
              <MeChip gold>
                {market ? `vs ${market.top_opportunities.length || 0} competitors` : 'No data'}
              </MeChip>
            </PanelHead>
            {market ? (
              <div className="space-y-[10px]">
                <RRow
                  label="Keywords compared"
                  value={market.total_keywords_compared.toLocaleString()}
                />
                <RRow
                  label="Competitor leads"
                  value={market.keywords_competitor_wins.toLocaleString()}
                />
                <RRow
                  label="Average gap"
                  value={
                    market.avg_gap != null
                      ? `${market.avg_gap > 0 ? '+' : ''}${market.avg_gap}`
                      : '—'
                  }
                />
              </div>
            ) : (
              <EmptyHint message="Benchmark data not yet available." />
            )}
          </MePanel>

          {/* Link intelligence */}
          <MePanel>
            <PanelHead title="Link intelligence">
              {links && links.new_backlinks > 0 ? (
                <MeTrend dir="up">{links.new_backlinks}</MeTrend>
              ) : (
                <MeChip>{links ? 'No new links' : 'No data'}</MeChip>
              )}
            </PanelHead>
            {links ? (
              <div className="space-y-[10px]">
                <RRow label="Referring domains" value={links.referring_domains.toLocaleString()} />
                <RRow
                  label="New this month"
                  value={`+${links.new_backlinks.toLocaleString()}`}
                />
                <RRow
                  label="Authority score"
                  value={links.avg_domain_rank != null ? links.avg_domain_rank.toString() : '—'}
                />
              </div>
            ) : (
              <EmptyHint message="Link data not yet available." />
            )}
          </MePanel>

          {/* Data source usage */}
          <MePanel>
            <PanelHead title="Data source usage">
              <MePill tone="track">Healthy</MePill>
            </PanelHead>
            {usage ? (
              <div className="space-y-[10px]">
                <RRow label="Total spend (USD)" value={`$${usage.total_cost_usd.toFixed(4)}`} />
                <RRow label="Total API calls" value={usage.total_calls.toLocaleString()} />
                <UsageMeters usage={usage} />
              </div>
            ) : (
              <EmptyHint message="No data-source usage recorded this month." />
            )}
          </MePanel>
        </section>

        {/* ── GEO Deployment ────────────────────────────────────────────── */}
        <MePanel>
          <MePanelHeader
            title="GEO deployment"
            right={
              geo.active_version != null ? (
                <MePill tone="track">v{geo.active_version} active</MePill>
              ) : (
                <MePill tone="attn">No active directive</MePill>
              )
            }
          />
          <div className="grid grid-cols-3 gap-4">
            <HeroStat
              value={geo.active_version != null ? `v${geo.active_version}` : '—'}
              label="Active version"
              gold
            />
            <HeroStat
              value={geo.deployed_pages_count.toLocaleString()}
              label="Pages with snippet"
              gold
            />
            <HeroStat
              value={geo.published_blogs_this_month.toLocaleString()}
              label="Blogs published"
              gold
            />
          </div>

          {geo.deployed_pages.length > 0 && (
            <div className="mt-5 border-t border-black/[.06] pt-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-black/40">
                Deployed URLs
              </p>
              <ul className="space-y-1">
                {geo.deployed_pages.map((url, i) => (
                  <li
                    key={i}
                    className="rounded-md bg-me-ivory px-3 py-1.5 font-mono text-[12px] text-black/65"
                  >
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
                    {url}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {geo.deployed_pages.length === 0 && geo.active_version == null && (
<<<<<<< HEAD
            <p className="mt-4 text-center text-sm text-black/40">
              No GEO directive deployed yet.{' '}
              <Link href="/dashboard/geo-composer" className="font-semibold text-[#C4912E] hover:underline">
=======
            <p className="mt-4 text-center text-[13px] text-black/45">
              No GEO directive deployed yet.{' '}
              <Link href="/dashboard/geo-composer" className="font-semibold text-me-ochre hover:underline">
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
                Go to GEO Composer →
              </Link>
            </p>
          )}
        </MePanel>
<<<<<<< HEAD
      </section>

      {/* ── §4 Competitive Comparison ────────────────────────────────── */}
      <section>
        <SectionHeader number="4" title="Competitive Comparison" />
        <MePanel className="overflow-hidden !p-0">
          {competitive.length === 0 ? (
            <p className="py-8 text-center text-sm text-black/40">
              No query run data yet. Run the AI Visibility Tracker first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-black/[.06] bg-[#FBF8F3]">
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[.10em] text-black/40 w-2/5">Query</th>
                    <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[.10em] text-black/40 w-24">Your Rank</th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[.10em] text-black/40">Competitors</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[.10em] text-black/40 w-24">Engine</th>
                  </tr>
                </thead>
                <tbody>
                  {competitive.map((row, i) => {
                    const rankStyle: React.CSSProperties =
                      row.client_rank == null
                        ? { color: '#C2453A', background: 'rgba(194,69,58,.08)' }
                        : row.client_rank <= 3
                        ? { color: '#5C8A4A', background: 'rgba(92,138,74,.10)' }
                        : { color: '#C4912E', background: 'rgba(196,145,46,.10)' };

                    return (
                      <tr key={i} className="border-b border-black/[.04] last:border-0 transition-colors hover:bg-[#FBF8F3]">
                        <td className="px-5 py-[13px] text-xs text-[#1A1A1A] leading-snug">
                          &quot;{row.question}&quot;
                        </td>
                        <td className="px-4 py-[13px] text-center">
                          <span
                            className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                            style={rankStyle}
                          >
                            {row.client_rank != null ? `#${row.client_rank}` : 'N/M'}
                          </span>
                        </td>
                        <td className="px-5 py-[13px]">
                          {row.competitors.length === 0 ? (
                            <span className="text-xs text-black/30">No run data</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {row.competitors.map((c, ci) => (
                                <MeChip key={ci}>#{c.rank} {c.brand}</MeChip>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-[13px] text-right text-xs text-black/40 font-mono">
                          {row.engine}
                        </td>
                      </tr>
                    );
                  })}
=======

        {/* ── Competitive comparison (top 10 queries) ───────────────────── */}
        <MePanel>
          <MePanelHeader
            title="Competitive comparison"
            right={<MeChip>{competitive.length} queries</MeChip>}
          />
          {competitive.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-black/45">
              No query run data yet — run the AI Visibility Tracker first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <MeTable>
                <thead>
                  <MeTr>
                    <MeTh>Query</MeTh>
                    <MeTh>Your rank</MeTh>
                    <MeTh>Competitors (top 5)</MeTh>
                    <MeTh>Engine</MeTh>
                  </MeTr>
                </thead>
                <tbody>
                  {competitive.map((row, i) => (
                    <MeTr key={i}>
                      <MeTd>
                        <span className="text-[12.5px] text-black/70">&quot;{row.question}&quot;</span>
                      </MeTd>
                      <MeTd>
                        <RankBadge rank={row.client_rank} />
                      </MeTd>
                      <MeTd>
                        {row.competitors.length === 0 ? (
                          <span className="text-[12px] text-black/40">No run data</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {row.competitors.map((c, ci) => (
                              <MeChip key={ci}>
                                #{c.rank} {c.brand}
                              </MeChip>
                            ))}
                          </div>
                        )}
                      </MeTd>
                      <MeTd>
                        <span className="font-mono text-[12px] text-black/45">{row.engine}</span>
                      </MeTd>
                    </MeTr>
                  ))}
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
                </tbody>
              </MeTable>
            </div>
          )}
        </MePanel>
<<<<<<< HEAD
      </section>

      {/* ── §5–9 rpanel 2-column grid ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section>
          <SectionHeader number="5" title="Link Intelligence" />
          <LinkIntelligencePanel data={report.links} />
        </section>

        <section>
          <SectionHeader number="6" title="Search Visibility" />
          <SearchVisibilityPanel data={report.search} />
        </section>

        <section>
          <SectionHeader number="7" title="Local Visibility" />
          <LocalVisibilityPanel data={report.local} />
        </section>

        <section>
          <SectionHeader number="8" title="Market Benchmark" />
          <MarketBenchmarkPanel data={report.market} />
        </section>

        <section className="lg:col-span-2">
          <SectionHeader number="9" title="Data Source Usage" />
          <DataSourceUsagePanel data={report.usage} />
        </section>
      </div>

      {/* ── §10 Next-Month Recommendations ──────────────────────────── */}
      <section>
        <SectionHeader number="10" title="Next Month Recommendations" />
        <MePanel>
          {recs ? (
            <div className="space-y-3">
              <div className="space-y-2">
                {recs.split('\n').map((line, i) => (
                  <p
                    key={i}
                    className={`text-sm leading-relaxed ${
                      line.match(/^\d+\./) ? 'font-semibold text-[#1A1A1A]' : 'ml-4 text-black/60'
                    }`}
                  >
                    {line}
                  </p>
                ))}
              </div>
              {recsCost != null && (
                <p className="text-xs text-black/30">
                  Generated by Strategy Engine · cost ${recsCost.toFixed(4)}
                </p>
              )}
              <button
                onClick={handleGenerateRecs}
                disabled={recsLoading}
                className="text-xs font-semibold text-[#C4912E] hover:underline disabled:opacity-50"
=======

        {/* ── Search Top Movers ─────────────────────────────────────────── */}
        {search && search.top_movers.length > 0 && (
          <MePanel>
            <MePanelHeader title="Top SERP movers" right={<MeChip>{search.top_movers.length}</MeChip>} />
            <div className="overflow-x-auto">
              <MeTable>
                <thead>
                  <MeTr>
                    <MeTh>Keyword</MeTh>
                    <MeTh num>Previous</MeTh>
                    <MeTh num>Current</MeTh>
                    <MeTh num>Change</MeTh>
                  </MeTr>
                </thead>
                <tbody>
                  {search.top_movers.map((m, i) => (
                    <MeTr key={i}>
                      <MeTd>
                        <span className="font-mono text-[12.5px] text-black/70">{m.keyword}</span>
                      </MeTd>
                      <MeTd num>
                        <span className="text-[12.5px] text-black/55">
                          {m.previous_rank != null ? `#${m.previous_rank}` : '—'}
                        </span>
                      </MeTd>
                      <MeTd num>
                        <span className="font-display text-[13px] font-bold text-me-charcoal">
                          {m.current_rank != null ? `#${m.current_rank}` : '—'}
                        </span>
                      </MeTd>
                      <MeTd num>
                        {m.delta != null && m.delta !== 0 ? (
                          <MeTrend dir={m.delta > 0 ? 'up' : 'down'}>{Math.abs(m.delta)}</MeTrend>
                        ) : (
                          <span className="text-[12px] text-black/40">—</span>
                        )}
                      </MeTd>
                    </MeTr>
                  ))}
                </tbody>
              </MeTable>
            </div>
          </MePanel>
        )}

        {/* ── Market top opportunities ──────────────────────────────────── */}
        {market && market.top_opportunities.length > 0 && (
          <MePanel>
            <MePanelHeader
              title="Top market opportunities"
              right={<MeChip>{market.top_opportunities.length}</MeChip>}
            />
            <div className="overflow-x-auto">
              <MeTable>
                <thead>
                  <MeTr>
                    <MeTh>Keyword</MeTh>
                    <MeTh num>Your rank</MeTh>
                    <MeTh num>Competitor</MeTh>
                    <MeTh>Domain</MeTh>
                    <MeTh num>Score</MeTh>
                  </MeTr>
                </thead>
                <tbody>
                  {market.top_opportunities.map((opp, i) => (
                    <MeTr key={i}>
                      <MeTd>
                        <span className="font-mono text-[12.5px] text-black/70">{opp.keyword}</span>
                      </MeTd>
                      <MeTd num>
                        <span className="text-[12.5px] text-black/55">
                          {opp.client_rank != null ? `#${opp.client_rank}` : '—'}
                        </span>
                      </MeTd>
                      <MeTd num>
                        <span className="font-display text-[13px] font-bold text-[#5C8A4A]">
                          {opp.competitor_rank != null ? `#${opp.competitor_rank}` : '—'}
                        </span>
                      </MeTd>
                      <MeTd>
                        <span className="text-[12.5px] text-black/55">{opp.competitor_domain}</span>
                      </MeTd>
                      <MeTd num>
                        <MeMeter value={Math.min(opp.opportunity_score, 100)} />
                      </MeTd>
                    </MeTr>
                  ))}
                </tbody>
              </MeTable>
            </div>
          </MePanel>
        )}

        {/* ── 4-Week sparkline (legacy data viz) ────────────────────────── */}
        {trend.length >= 2 && (
          <MePanel>
            <MePanelHeader
              title="4-Week ranking trend"
              right={<MeChip>{trend.length} weeks</MeChip>}
            />
            <p className="mb-3 text-[12.5px] text-black/55">
              Average AI rank across all queries (lower = better). Green line = improving trend.
            </p>
            <div className="overflow-x-auto">
              <TrendSparkline data={trend} width={700} height={140} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {trend.map((pt, i) => (
                <div key={i} className="rounded-xl border border-black/[.06] bg-me-ivory px-3 py-2.5">
                  <p className="font-mono text-[11px] text-black/40">{pt.week_of.slice(5)}</p>
                  <p className="mt-1 font-display text-[15px] font-bold text-me-charcoal">
                    {pt.avg_rank != null ? `#${pt.avg_rank}` : '—'}
                  </p>
                  <p className="text-[11px] text-black/45">{pt.mentions_count} mentions</p>
                </div>
              ))}
            </div>
          </MePanel>
        )}

        {/* ── Next-Month Recommendations (Strategy Engine) ─────────────── */}
        <MePanel>
          <MePanelHeader
            title="Next month recommendations"
            right={recsCost != null && <MeChip>Strategy Engine · ${recsCost.toFixed(4)}</MeChip>}
          />
          {recs ? (
            <div>
              <div className="space-y-2">
                {recs.split('\n').map((line, i) => {
                  const isHeading = /^\d+\./.test(line);
                  return (
                    <p
                      key={i}
                      className={
                        isHeading
                          ? 'text-[13.5px] font-semibold text-me-charcoal'
                          : 'pl-4 text-[13px] text-black/65'
                      }
                    >
                      {line}
                    </p>
                  );
                })}
              </div>
              <button
                onClick={handleGenerateRecs}
                disabled={recsLoading}
                className="mt-4 text-[12.5px] font-semibold text-me-ochre hover:underline disabled:opacity-50"
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
              >
                {recsLoading ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          ) : (
<<<<<<< HEAD
            <div className="space-y-4 py-2 text-center">
              <p className="text-sm text-black/60">
                Generate AI-powered recommendations based on this month&apos;s performance data.
              </p>
              {recsError && <p className="text-xs text-[#C2453A]">{recsError}</p>}
              <MeButton
                onClick={handleGenerateRecs}
                disabled={recsLoading}
                size="md"
              >
                {recsLoading ? '⏳ Generating…' : '✨ Generate Recommendations'}
=======
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <p className="text-[13px] text-black/55">
                Generate AI-powered recommendations based on this month&apos;s performance data.
              </p>
              {recsError && <p className="text-[12px] font-semibold text-[#C2453A]">{recsError}</p>}
              <MeButton size="sm" onClick={handleGenerateRecs} disabled={recsLoading}>
                {recsLoading ? 'Generating…' : 'Generate recommendations'}
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
              </MeButton>
            </div>
          )}
        </MePanel>
<<<<<<< HEAD
      </section>
=======

        <p className="text-[11.5px] text-black/40">
          Generated {new Date(report.generated_at).toLocaleString('en-AU')} · period{' '}
          {report.period_from} → {report.period_to}
        </p>
      </div>
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
    </div>
  );
}

// ── Local primitives (page-only) ─────────────────────────────────────────────

<<<<<<< HEAD
function buildExportHtml(report: MonthlyReportData, recommendations: string): string {
  const { overview, geo, competitive } = report;

  const competitiveRows = competitive.map(row => `
    <tr>
      <td style="padding:8px 12px; font-size:12px; color:#374151;">"${escHtml(row.question)}"</td>
      <td style="padding:8px 12px; text-align:center;">
        <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:${row.client_rank == null ? '#fee2e2' : row.client_rank <= 3 ? '#dcfce7' : '#fef9c3'}; color:${row.client_rank == null ? '#dc2626' : row.client_rank <= 3 ? '#16a34a' : '#92400e'};">
          ${row.client_rank != null ? `#${row.client_rank}` : 'N/M'}
        </span>
      </td>
      <td style="padding:8px 12px; font-size:11px; color:#6b7280;">
        ${row.competitors.map(c => `#${c.rank} ${escHtml(c.brand)}`).join(' · ') || '—'}
      </td>
    </tr>`
  ).join('');

  const recsHtml = recommendations
    ? recommendations.split('\n').filter(l => l.trim()).map(l =>
        `<p style="margin:0 0 8px; font-size:13px; color:${l.match(/^\d+\./) ? '#111827' : '#4b5563'}; font-weight:${l.match(/^\d+\./) ? '600' : '400'};">${escHtml(l)}</p>`
      ).join('')
    : '<p style="color:#9ca3af; font-size:13px;">Recommendations not generated.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(report.client_name)} — Monthly Report — ${escHtml(report.period_label)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; background: #f9fafb; padding: 32px; }
  .container { max-width: 880px; margin: 0 auto; }
  .header { margin-bottom: 32px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
  .header h1 { font-size: 24px; font-weight: 700; color: #111827; }
  .header p  { font-size: 12px; color: #9ca3af; margin-top: 4px; }
  .section { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
  .section-title { font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .badge { width: 22px; height: 22px; background: #C4912E; color: #fff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .kpi { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
  .kpi-label { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  .kpi-value { font-size: 22px; font-weight: 700; color: #111827; }
  .kpi-sub   { font-size: 11px; color: #9ca3af; margin-top: 2px; }
  .geo-grid  { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center; }
  .geo-num   { font-size: 28px; font-weight: 700; color: #C4912E; }
  .geo-lbl   { font-size: 11px; color: #6b7280; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f9fafb; font-size: 11px; font-weight: 600; color: #6b7280; text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
  tr:not(:last-child) td { border-bottom: 1px solid #f3f4f6; }
  .footer { font-size: 11px; color: #d1d5db; text-align: center; margin-top: 32px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${escHtml(report.period_label)} Monthly Report</h1>
    <p>${escHtml(report.client_name)} · ${report.period_from} to ${report.period_to}</p>
  </div>

  <!-- §1 Overview -->
  <div class="section">
    <div class="section-title"><span class="badge">1</span> AI Visibility Overview</div>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Avg Rank (this month)</div>
        <div class="kpi-value">${overview.this_month_avg_rank != null ? `#${overview.this_month_avg_rank}` : '—'}</div>
        <div class="kpi-sub">${overview.rank_change != null ? `${overview.rank_change < 0 ? '↑ improved' : '↓ worsened'} ${Math.abs(overview.rank_change)}` : 'No prior data'}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">AI Mentions (this month)</div>
        <div class="kpi-value">${overview.this_month_mentions}</div>
        <div class="kpi-sub">${overview.mention_change >= 0 ? '+' : ''}${overview.mention_change} vs last month</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Queries Tracked</div>
        <div class="kpi-value">${overview.queries_tracked}</div>
        <div class="kpi-sub">active queries</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">AI Engines</div>
        <div class="kpi-value">${overview.engines_used.length}</div>
        <div class="kpi-sub">${escHtml(overview.engines_used.join(', ') || 'none')}</div>
      </div>
=======
function PanelHead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="font-display text-[15px] font-semibold tracking-tight text-me-charcoal">
        {title}
      </h3>
      <div className="flex items-center">{children}</div>
>>>>>>> 5bb7c47 (feat(ui): Reports 月报页按设计稿重做 — 4-up 摘要 + sparkline + benchmark)
    </div>
  );
}

function BigStat({
  value,
  caption,
  gold = false,
}: {
  value: string;
  caption: string;
  gold?: boolean;
}) {
  return (
    <>
      <div
        className={`font-display text-[32px] font-bold leading-none ${
          gold ? 'bg-clip-text text-transparent' : 'text-me-charcoal'
        }`}
        style={gold ? { backgroundImage: GOLD_GRADIENT } : undefined}
      >
        {value}
      </div>
      <p className="mt-[5px] text-[12.5px] text-black/60">{caption}</p>
    </>
  );
}

function SparkLine({ points }: { points: string }) {
  return (
    <svg
      viewBox="0 0 300 42"
      preserveAspectRatio="none"
      className="mt-4 h-[42px] w-full"
      role="img"
      aria-label="Trend sparkline"
    >
      <defs>
        <linearGradient id="me-spark-grad" x1="0" y1="0" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EBCB8B" />
          <stop offset="1" stopColor="#C4912E" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke="url(#me-spark-grad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[.06em] text-black/40">{label}</p>
      <p className="mt-0.5 font-display text-[14px] font-bold text-me-charcoal">{value}</p>
    </div>
  );
}

function RRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/[.06] py-[7px] last:border-b-0">
      <span className="text-[12.5px] text-black/55">{label}</span>
      <span className="font-mono text-[13px] font-semibold text-me-charcoal">{value}</span>
    </div>
  );
}

function HeroStat({ value, label, gold = false }: { value: string; label: string; gold?: boolean }) {
  return (
    <div className="text-center">
      <div
        className={`font-display text-[26px] font-bold leading-none ${
          gold ? 'bg-clip-text text-transparent' : 'text-me-charcoal'
        }`}
        style={gold ? { backgroundImage: GOLD_GRADIENT } : undefined}
      >
        {value}
      </div>
      <p className="mt-1.5 text-[12px] text-black/55">{label}</p>
    </div>
  );
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank == null) {
    return (
      <span className="inline-block rounded-full bg-[#C2453A]/10 px-2.5 py-0.5 text-[11px] font-bold text-[#C2453A]">
        N/M
      </span>
    );
  }
  const tone =
    rank <= 3
      ? 'bg-[#5C8A4A]/12 text-[#5C8A4A]'
      : rank <= 10
        ? 'bg-[#C4912E]/12 text-[#C4912E]'
        : 'bg-black/[.06] text-black/55';
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${tone}`}>
      #{rank}
    </span>
  );
}

function EmptyHint({ message }: { message: string }) {
  return <p className="py-2 text-[13px] text-black/45">{message}</p>;
}

function UsageMeters({ usage }: { usage: DataSourceUsageData }) {
  const top = [...usage.services].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 3);
  const max = Math.max(...top.map(s => s.cost_usd), 0.0001);

  if (top.length === 0) return null;

  return (
    <div className="mt-2 space-y-2.5">
      {top.map((svc, i) => {
        const pct = Math.round((svc.cost_usd / max) * 100);
        return (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="truncate text-[12px] text-black/55">{displayServiceName(svc.service)}</span>
            <MeMeter value={pct} />
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Hide real vendor names (CLAUDE.md §三 — UI must use wrapper names).
 */
const SERVICE_DISPLAY_MAP: Record<string, string> = {
  dataforseo: 'Link / SERP / Local Intelligence',
  semrush: 'Keyword Intelligence',
  openai: 'Content Engine',
  anthropic: 'Strategy Engine',
  serpapi: 'Search Intelligence',
  perplexity: 'Discovery Engine',
  google: 'Search AI Engine',
  wavespeed: 'Visual Studio',
  atlas: 'Visual Studio',
  heygen: 'Avatar Studio',
  airtable: 'Content Workspace',
  publer: 'Publishing Hub',
};

function displayServiceName(service: string): string {
  return SERVICE_DISPLAY_MAP[service.toLowerCase()] ?? 'Data Source';
}

/**
 * Build a 300×42 sparkline polyline from mention counts.
 * Higher mentions → higher on the chart (Y is flipped from SVG default).
 */
function buildSparkPoints(trend: TrendPoint[]): string {
  if (trend.length < 2) return '0,21 300,21';

  const values = trend.map(t => t.mentions_count);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const W = 300;
  const H = 42;
  const padY = 4;
  const usableH = H - padY * 2;

  return trend
    .map((t, i) => {
      const x = (i / Math.max(trend.length - 1, 1)) * W;
      // Higher mentions -> lower Y (top of chart)
      const y = padY + usableH - ((t.mentions_count - min) / range) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * Build a 300×42 sparkline polyline from avg_rank.
 * Lower rank = better, so invert: lower rank -> higher on chart.
 */
function buildSparkRankPoints(trend: TrendPoint[]): string {
  const valid = trend.filter(t => t.avg_rank != null) as Array<TrendPoint & { avg_rank: number }>;
  if (valid.length < 2) return '0,21 300,21';

  const ranks = valid.map(t => t.avg_rank);
  const max = Math.max(...ranks);
  const min = Math.min(...ranks);
  const range = max - min || 1;

  const W = 300;
  const H = 42;
  const padY = 4;
  const usableH = H - padY * 2;

  return valid
    .map((t, i) => {
      const x = (i / Math.max(valid.length - 1, 1)) * W;
      // Lower rank -> top of chart
      const y = padY + ((t.avg_rank - min) / range) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
