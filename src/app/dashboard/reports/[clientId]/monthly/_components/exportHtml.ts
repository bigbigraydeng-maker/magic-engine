/**
 * HTML export builder for the Monthly Insight Report.
 * Renders a self-contained, standalone HTML document — used by the
 * "Download HTML" button.
 *
 * Kept as a plain TS module (no React) so the data shape is easy to test
 * and the page bundle stays focused on the live UI.
 */
import type { MonthlyReportData } from '@/lib/reports/monthly-aggregator'

export function buildExportHtml(report: MonthlyReportData, recommendations: string): string {
  const { overview, geo, competitive } = report

  const competitiveRows = competitive
    .map(
      row => `
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
    </tr>`,
    )
    .join('')

  const recsHtml = recommendations
    ? recommendations
        .split('\n')
        .filter(l => l.trim())
        .map(
          l =>
            `<p style="margin:0 0 8px; font-size:13px; color:${/^\d+\./.test(l) ? '#1A1A1A' : 'rgba(26,26,26,0.70)'}; font-weight:${/^\d+\./.test(l) ? '600' : '400'};">${escHtml(l)}</p>`,
        )
        .join('')
    : '<p style="color:rgba(26,26,26,0.45); font-size:13px;">Recommendations not generated.</p>'

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
    <h1>Monthly Insight Report · ${escHtml(report.period_label)}</h1>
    <p>${escHtml(report.client_name)} · ${report.period_from} to ${report.period_to}</p>
  </div>

  <div class="section">
    <div class="section-title"><span class="badge">1</span> AI Visibility Overview</div>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Avg Rank (this month)</div>
        <div class="kpi-value">${overview.this_month_avg_rank != null ? `#${overview.this_month_avg_rank}` : '—'}</div>
        <div class="kpi-sub">${overview.rank_change != null ? `${overview.rank_change < 0 ? 'improved' : 'worsened'} ${Math.abs(overview.rank_change)}` : 'No prior data'}</div>
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

  <div class="section">
    <div class="section-title"><span class="badge">2</span> GEO Deployment</div>
    <div class="geo-grid">
      <div><div class="geo-num">${geo.active_version != null ? `v${geo.active_version}` : '—'}</div><div class="geo-lbl">Active Version</div></div>
      <div><div class="geo-num">${geo.deployed_pages_count}</div><div class="geo-lbl">Pages with Snippet</div></div>
      <div><div class="geo-num">${geo.published_blogs_this_month}</div><div class="geo-lbl">Blogs Published</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title"><span class="badge">3</span> Competitive Comparison</div>
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

  <div class="section">
    <div class="section-title"><span class="badge">4</span> Next Month Recommendations</div>
    ${recsHtml}
  </div>

  <div class="footer">Generated by Magic Engine · ${new Date().toLocaleDateString('en-AU')}</div>
</div>
</body>
</html>`
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
