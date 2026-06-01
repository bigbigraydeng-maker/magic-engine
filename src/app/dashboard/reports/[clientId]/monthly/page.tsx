'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TrendSparkline } from './_components/TrendSparkline';
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

/**
 * /dashboard/reports/[clientId]/monthly
 *
 * 5-section monthly client report:
 *  §1  AI Visibility Overview (KPI cards)
 *  §2  4-week Ranking Trend (sparkline)
 *  §3  GEO Deployment Log
 *  §4  Competitive Comparison (top 10 queries)
 *  §5  Next-Month Recommendations (Strategy Engine)
 *
 * Reference: ROADMAP.md P7.4.1–P7.4.7
 */
export default function MonthlyReportPage() {
  const params   = useParams();
  const clientId = params.clientId as string;

  const [report,  setReport]  = useState<MonthlyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Recommendations state
  const [recs,         setRecs]         = useState('');
  const [recsLoading,  setRecsLoading]  = useState(false);
  const [recsCost,     setRecsCost]     = useState<number | null>(null);
  const [recsError,    setRecsError]    = useState('');

  // Export state
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/reports/${clientId}/monthly`);
      const j   = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Failed to load report');
      setReport(j.report);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading report');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

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
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
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
      <div className="space-y-4 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded-[14px] bg-[#EAE6DF]" />
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-[110px] rounded-[24px] bg-[#EAE6DF]" />)}
          </div>
          <div className="h-[160px] rounded-[24px] bg-[#EAE6DF]" />
          <div className="grid grid-cols-2 gap-4">
            {[1,2,3,4,5,6].map(i => <div key={i} className="h-[160px] rounded-[24px] bg-[#EAE6DF]" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6">
        <MePanel>
          <p className="text-sm text-[#C2453A]">{error || 'Report not found.'}</p>
          <button onClick={fetchReport} className="mt-2 text-sm font-semibold text-[#C4912E] hover:underline">
            Retry
          </button>
        </MePanel>
      </div>
    );
  }

  const { overview, trend, geo, competitive } = report;

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
        </div>
      </section>

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
                    {url}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {geo.deployed_pages.length === 0 && geo.active_version == null && (
            <p className="mt-4 text-center text-sm text-black/40">
              No GEO directive deployed yet.{' '}
              <Link href="/dashboard/geo-composer" className="font-semibold text-[#C4912E] hover:underline">
                Go to GEO Composer →
              </Link>
            </p>
          )}
        </MePanel>
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
                </tbody>
              </table>
            </div>
          )}
        </MePanel>
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
              >
                Regenerate
              </button>
            </div>
          ) : (
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
              </MeButton>
            </div>
          )}
        </MePanel>
      </section>
    </div>
  );
}

// ── HTML Export Builder ────────────────────────────────────────────────────────

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
    </div>
  </div>

  <!-- §3 GEO -->
  <div class="section">
    <div class="section-title"><span class="badge">3</span> GEO Deployment</div>
    <div class="geo-grid">
      <div><div class="geo-num">${geo.active_version != null ? `v${geo.active_version}` : '—'}</div><div class="geo-lbl">Active Version</div></div>
      <div><div class="geo-num">${geo.deployed_pages_count}</div><div class="geo-lbl">Pages with Snippet</div></div>
      <div><div class="geo-num">${geo.published_blogs_this_month}</div><div class="geo-lbl">Blogs Published</div></div>
    </div>
  </div>

  <!-- §4 Competitive -->
  <div class="section">
    <div class="section-title"><span class="badge">4</span> Competitive Comparison</div>
    <table>
      <thead>
        <tr>
          <th style="width:40%">Query</th>
          <th style="text-align:center; width:80px">Your Rank</th>
          <th>Competitors</th>
        </tr>
      </thead>
      <tbody>${competitiveRows}</tbody>
    </table>
  </div>

  <!-- §5 Recommendations -->
  <div class="section">
    <div class="section-title"><span class="badge">5</span> Next Month Recommendations</div>
    ${recsHtml}
  </div>

  <div class="footer">Generated by Magic Engine · ${new Date().toLocaleDateString('en-AU')}</div>
</div>
</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
