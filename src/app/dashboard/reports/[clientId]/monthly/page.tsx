'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TrendSparkline } from './_components/TrendSparkline';
import { SectionHeader, KpiCard } from './_components/Shared';
import { LinkIntelligencePanel } from './_components/LinkIntelligencePanel';
import { SearchVisibilityPanel } from './_components/SearchVisibilityPanel';
import { LocalVisibilityPanel } from './_components/LocalVisibilityPanel';
import { MarketBenchmarkPanel } from './_components/MarketBenchmarkPanel';
import { DataSourceUsagePanel } from './_components/DataSourceUsagePanel';
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
      <div className="p-6 space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-me-stone rounded w-64" />
          <div className="grid grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="h-28 bg-me-stone rounded-xl" />)}
          </div>
          <div className="h-40 bg-me-stone rounded-xl" />
          <div className="h-48 bg-me-stone rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6">
        <p className="text-[#C2453A] text-sm">{error || 'Report not found.'}</p>
        <button onClick={fetchReport} className="mt-2 text-me-ochre text-sm hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const { overview, trend, geo, competitive } = report;

  const rankArrow = overview.rank_change !== null
    ? overview.rank_change < 0 ? '↑' : overview.rank_change > 0 ? '↓' : '→'
    : '—';
  const rankColor = overview.rank_change !== null
    ? overview.rank_change < 0 ? 'text-[#5C8A4A]' : overview.rank_change > 0 ? 'text-[#C2453A]' : 'text-me-charcoal/55'
    : 'text-me-charcoal/45';

  const mentionArrow = overview.mention_change > 0 ? '↑' : overview.mention_change < 0 ? '↓' : '→';
  const mentionColor = overview.mention_change > 0 ? 'text-[#5C8A4A]' : overview.mention_change < 0 ? 'text-[#C2453A]' : 'text-me-charcoal/55';

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-me-charcoal/45 mb-1">
            <Link href="/dashboard/clients" className="hover:text-me-charcoal/60">Clients</Link>
            <span>/</span>
            <span>{report.client_name}</span>
            <span>/</span>
            <span>Monthly Report</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal/90">
            📊 {report.period_label} — {report.client_name}
          </h1>
          <p className="text-xs text-me-charcoal/45 mt-1">
            Period: {report.period_from} → {report.period_to} · Generated {new Date(report.generated_at).toLocaleString('en-AU')}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 bg-me-charcoal/90 hover:bg-me-charcoal/60 disabled:bg-me-charcoal/25 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {exporting ? '…' : '⬇ Export HTML'}
        </button>
      </div>

      {/* ── §1 AI Visibility Overview ────────────────────────────────── */}
      <section>
        <SectionHeader number="1" title="AI Visibility Overview" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Avg AI Rank (this month)"
            value={overview.this_month_avg_rank != null ? `#${overview.this_month_avg_rank}` : '—'}
            sub={
              overview.rank_change != null
                ? <span className={`text-xs font-semibold ${rankColor}`}>
                    {rankArrow} {Math.abs(overview.rank_change)} vs last month
                  </span>
                : <span className="text-xs text-me-charcoal/45">No prior data</span>
            }
            highlight={overview.rank_change !== null && overview.rank_change < 0}
          />
          <KpiCard
            label="AI Mentions (this month)"
            value={overview.this_month_mentions.toString()}
            sub={
              <span className={`text-xs font-semibold ${mentionColor}`}>
                {mentionArrow} {Math.abs(overview.mention_change)} vs last month
              </span>
            }
          />
          <KpiCard
            label="Queries Tracked"
            value={overview.queries_tracked.toString()}
            sub={<span className="text-xs text-me-charcoal/45">active queries</span>}
          />
          <KpiCard
            label="AI Engines"
            value={overview.engines_used.length.toString()}
            sub={
              <span className="text-xs text-me-charcoal/45 truncate">
                {overview.engines_used.join(', ') || 'none yet'}
              </span>
            }
          />
        </div>
      </section>

      {/* ── §2 4-week Trend ──────────────────────────────────────────── */}
      <section>
        <SectionHeader number="2" title="4-Week Ranking Trend" />
        <div className="bg-white rounded-xl border border-black/10 p-5">
          {trend.length < 2 ? (
            <p className="text-sm text-me-charcoal/45 text-center py-6">
              Not enough data yet — run the AI Visibility Tracker for at least 2 weeks.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-me-charcoal/55">
                Average AI rank across all queries (lower = better). Green line = improving trend.
              </p>
              <TrendSparkline data={trend} width={600} height={110} />
              <div className="flex gap-6 mt-2">
                {trend.map((pt, i) => (
                  <div key={i} className="text-center">
                    <p className="text-xs font-mono text-me-charcoal/45">{pt.week_of.slice(5)}</p>
                    <p className="text-sm font-bold text-me-charcoal/75">
                      {pt.avg_rank != null ? `#${pt.avg_rank}` : '—'}
                    </p>
                    <p className="text-xs text-me-charcoal/45">{pt.mentions_count} mentions</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── §3 GEO Deployment ────────────────────────────────────────── */}
      <section>
        <SectionHeader number="3" title="GEO Deployment" />
        <div className="bg-white rounded-xl border border-black/10 p-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-me-ochre">
                {geo.active_version != null ? `v${geo.active_version}` : '—'}
              </p>
              <p className="text-xs text-me-charcoal/55 mt-1">Active GEO Version</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-me-ochre">
                {geo.deployed_pages_count}
              </p>
              <p className="text-xs text-me-charcoal/55 mt-1">Pages with Snippet</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-me-ochre">
                {geo.published_blogs_this_month}
              </p>
              <p className="text-xs text-me-charcoal/55 mt-1">Blogs Published (this month)</p>
            </div>
          </div>

          {geo.deployed_pages.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-me-charcoal/55 mb-2">Deployed URLs</p>
              <ul className="space-y-1">
                {geo.deployed_pages.map((url, i) => (
                  <li key={i} className="text-xs font-mono text-me-charcoal/75 bg-me-ivory px-3 py-1.5 rounded">
                    {url}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {geo.deployed_pages.length === 0 && geo.active_version == null && (
            <p className="text-sm text-me-charcoal/45 text-center py-2">
              No GEO directive deployed yet.{' '}
              <Link href={`/dashboard/geo-composer`} className="text-me-ochre hover:underline">
                Go to GEO Composer →
              </Link>
            </p>
          )}
        </div>
      </section>

      {/* ── §4 Competitive Comparison ────────────────────────────────── */}
      <section>
        <SectionHeader number="4" title="Competitive Comparison" />
        <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
          {competitive.length === 0 ? (
            <p className="text-sm text-me-charcoal/45 text-center py-8">
              No query run data yet. Run the AI Visibility Tracker first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[.06] bg-me-ivory">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 w-2/5">Query</th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-me-charcoal/55 w-20">Your Rank</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55">Competitors (top 5)</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-me-charcoal/55 w-24">Engine</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[.06]">
                  {competitive.map((row, i) => {
                    const rankBadge = row.client_rank == null
                      ? 'bg-[#C2453A]/10 text-[#C2453A]'
                      : row.client_rank <= 3
                      ? 'bg-[#5C8A4A]/10 text-[#5C8A4A]'
                      : 'bg-me-ochre/10 text-me-ochre';

                    return (
                      <tr key={i} className="hover:bg-me-ivory/50">
                        <td className="px-4 py-3 text-xs text-me-charcoal/75 leading-snug">
                          &quot;{row.question}&quot;
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${rankBadge}`}>
                            {row.client_rank != null ? `#${row.client_rank}` : 'N/M'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.competitors.length === 0 ? (
                            <span className="text-xs text-me-charcoal/45">No run data</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {row.competitors.map((c, ci) => (
                                <span key={ci} className="text-xs bg-me-ivory text-me-charcoal/60 px-2 py-0.5 rounded">
                                  #{c.rank} {c.brand}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-me-charcoal/45 font-mono">
                          {row.engine}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── §5 Link Intelligence ─────────────────────────────────────── */}
      <section>
        <SectionHeader number="5" title="🔗 Link Intelligence" />
        <LinkIntelligencePanel data={report.links} />
      </section>

      {/* ── §6 Search Visibility ─────────────────────────────────────── */}
      <section>
        <SectionHeader number="6" title="🔍 Search Visibility" />
        <SearchVisibilityPanel data={report.search} />
      </section>

      {/* ── §7 Local Visibility ──────────────────────────────────────── */}
      <section>
        <SectionHeader number="7" title="📍 Local Visibility" />
        <LocalVisibilityPanel data={report.local} />
      </section>

      {/* ── §8 Market Benchmark ──────────────────────────────────────── */}
      <section>
        <SectionHeader number="8" title="🎯 Market Benchmark" />
        <MarketBenchmarkPanel data={report.market} />
      </section>

      {/* ── §9 Data Source Usage ─────────────────────────────────────── */}
      <section>
        <SectionHeader number="9" title="💰 Data Source Usage" />
        <DataSourceUsagePanel data={report.usage} />
      </section>

      {/* ── §10 Next-Month Recommendations ──────────────────────────── */}
      <section>
        <SectionHeader number="10" title="Next Month Recommendations" />
        <div className="bg-white rounded-xl border border-black/10 p-5 space-y-4">
          {recs ? (
            <div>
              <div className="prose prose-sm max-w-none">
                {recs.split('\n').map((line, i) => (
                  <p key={i} className={`text-sm ${line.match(/^\d+\./) ? 'font-medium text-me-charcoal/90' : 'text-me-charcoal/60 ml-4'} mb-2`}>
                    {line}
                  </p>
                ))}
              </div>
              {recsCost != null && (
                <p className="text-xs text-me-charcoal/45 mt-3">Generated by Strategy Engine · cost ${recsCost.toFixed(4)}</p>
              )}
              <button
                onClick={handleGenerateRecs}
                disabled={recsLoading}
                className="mt-3 text-xs text-me-ochre hover:text-me-ochre underline"
              >
                Regenerate
              </button>
            </div>
          ) : (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-me-charcoal/55">
                Generate AI-powered recommendations based on this month&apos;s performance data.
              </p>
              {recsError && (
                <p className="text-xs text-[#C2453A]">{recsError}</p>
              )}
              <button
                onClick={handleGenerateRecs}
                disabled={recsLoading}
                className="px-5 py-2.5 bg-me-ochre hover:bg-me-ochre disabled:bg-me-ochre/70 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {recsLoading ? '⏳ Generating…' : '✨ Generate Recommendations'}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ── HTML Export Builder ────────────────────────────────────────────────────────

function buildExportHtml(report: MonthlyReportData, recommendations: string): string {
  const { overview, geo, competitive } = report;

  const competitiveRows = competitive.map(row => `
    <tr>
      <td style="padding:8px 12px; font-size:12px; color:#1A1A1A;">"${escHtml(row.question)}"</td>
      <td style="padding:8px 12px; text-align:center;">
        <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:${row.client_rank == null ? 'rgba(194,69,58,0.10)' : row.client_rank <= 3 ? 'rgba(92,138,74,0.12)' : 'rgba(196,145,46,0.10)'}; color:${row.client_rank == null ? '#C2453A' : row.client_rank <= 3 ? '#5C8A4A' : '#C4912E'};">
          ${row.client_rank != null ? `#${row.client_rank}` : 'N/M'}
        </span>
      </td>
      <td style="padding:8px 12px; font-size:11px; color:rgba(26,26,26,0.60);">
        ${row.competitors.map(c => `#${c.rank} ${escHtml(c.brand)}`).join(' · ') || '—'}
      </td>
    </tr>`
  ).join('');

  const recsHtml = recommendations
    ? recommendations.split('\n').filter(l => l.trim()).map(l =>
        `<p style="margin:0 0 8px; font-size:13px; color:${l.match(/^\d+\./) ? '#1A1A1A' : 'rgba(26,26,26,0.70)'}; font-weight:${l.match(/^\d+\./) ? '600' : '400'};">${escHtml(l)}</p>`
      ).join('')
    : '<p style="color:rgba(26,26,26,0.45); font-size:13px;">Recommendations not generated.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(report.client_name)} — Monthly Report — ${escHtml(report.period_label)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1A1A1A; background: #FBF8F3; padding: 32px; }
  .container { max-width: 880px; margin: 0 auto; }
  .header { margin-bottom: 32px; border-bottom: 2px solid #EAE6DF; padding-bottom: 20px; }
  .header h1 { font-size: 24px; font-weight: 700; color: #1A1A1A; }
  .header p  { font-size: 12px; color: rgba(26,26,26,0.45); margin-top: 4px; }
  .section { background: #fff; border: 1px solid #EAE6DF; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
  .section-title { font-size: 14px; font-weight: 700; color: #1A1A1A; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .badge { width: 22px; height: 22px; background: #C4912E; color: #fff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .kpi { background: #FBF8F3; border: 1px solid #EAE6DF; border-radius: 8px; padding: 14px; }
  .kpi-label { font-size: 11px; color: rgba(26,26,26,0.60); margin-bottom: 4px; }
  .kpi-value { font-size: 22px; font-weight: 700; color: #1A1A1A; }
  .kpi-sub   { font-size: 11px; color: rgba(26,26,26,0.45); margin-top: 2px; }
  .geo-grid  { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center; }
  .geo-num   { font-size: 28px; font-weight: 700; color: #C4912E; }
  .geo-lbl   { font-size: 11px; color: rgba(26,26,26,0.60); margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #FBF8F3; font-size: 11px; font-weight: 600; color: rgba(26,26,26,0.60); text-align: left; padding: 10px 12px; border-bottom: 1px solid #EAE6DF; }
  tr:not(:last-child) td { border-bottom: 1px solid #EAE6DF; }
  .footer { font-size: 11px; color: rgba(26,26,26,0.35); text-align: center; margin-top: 32px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>📊 ${escHtml(report.period_label)} Monthly Report</h1>
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
