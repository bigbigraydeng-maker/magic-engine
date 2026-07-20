/**
 * Zhangqian Discovery — Client-shareable HTML deck generator (v1.1 · P8.13.E).
 *
 * Bro of docx-generator.ts. Produces a single self-contained HTML page (inline
 * CSS · no external assets · no JS) that FDE/PM can send to the client via a
 * shareable link. Editorial style — serif display · warm neutral ground · Ray
 * White-adjacent navy + gold accents — matches the tone of the Roman Hu deck
 * that validated the plugin merge.
 *
 * Design principles:
 * - Self-contained: inline everything so the file can be emailed / uploaded to
 *   any static host (Cloudflare Pages · S3 · GitHub Pages) with no build step.
 * - Bilingual: Chinese primary (matches 张骞 prompt output) · English proper
 *   nouns preserved. Body font stack covers both.
 * - Editorial not sales-y: this is a snapshot report the client uses to
 *   decide what to fix — not a landing page. Restrained typography, no CTAs,
 *   no promo copy.
 * - Consumer-safe: strip anything that leaks vendor names (SEMrush, DataForSEO
 *   etc.) — clients see "Keyword Intelligence", "Site Analyzer" style copy.
 *   The docx generator has the same rule.
 *
 * Consumed by `GET /api/clients/[id]/zhangqian/html`.
 */

import type {
  DiscoveryReport,
  DiscoveredMediaChannel,
  DiscoveredMarketContext,
  SanityIssue,
  MediaChannelCategory,
} from './types'

// ─── Public API ──────────────────────────────────────────────────────────────

export interface GenerateHtmlOptions {
  /** Display name shown on the cover — matches `clients.name`. */
  clientName: string
  /** Human-readable date shown on the cover (defaults to today NZ). */
  reportDate?: string
}

export function generateZhangqianHtml(
  report: DiscoveryReport,
  opts: GenerateHtmlOptions,
): string {
  const dateStr =
    opts.reportDate ??
    new Date().toLocaleDateString('en-NZ', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

  const sections: string[] = [
    coverSection(report, opts.clientName, dateStr),
    businessSection(report),
    diagnosisSection(report),
    keywordsSection(report),
    competitorsSection(report),
    aiVisibilitySection(report),
    localMediaSection(report),
    marketContextSection(report),
    sanityIssuesSection(report),
    notesSection(report),
    colophonSection(opts.clientName, dateStr),
  ]

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(opts.clientName)} · Discovery Report · Magic Engine</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
${sections.filter(s => s.trim().length > 0).join('\n')}
</div>
</body>
</html>`
}

// ─── Sections ────────────────────────────────────────────────────────────────

function coverSection(report: DiscoveryReport, clientName: string, dateStr: string): string {
  const business = report.business
  const overall = report.diagnosis?.scores.overall ?? null
  const location = [business.location.city, business.location.region, business.location.country]
    .filter(Boolean)
    .join(', ')

  return `<header class="cover">
<div class="kicker">Magic Engine · Discovery Report</div>
<h1>${escapeHtml(clientName)}</h1>
<p class="domain">${escapeHtml(report.domain)}</p>
<p class="date">${escapeHtml(dateStr)}</p>
${overall !== null ? `<div class="stat"><span class="label">Overall</span> <span class="value">${overall} / 100</span></div>` : ''}
${location ? `<div class="stat"><span class="label">Location</span> <span class="value">${escapeHtml(location)}</span></div>` : ''}
${business.industry.length ? `<div class="stat"><span class="label">Industry</span> <span class="value">${escapeHtml(business.industry.join(' / '))}</span></div>` : ''}
</header>`
}

function businessSection(report: DiscoveryReport): string {
  const b = report.business
  const usps = b.unique_selling_points.length
    ? `<h4>Unique selling points</h4><ul>${b.unique_selling_points.map(u => `<li>${escapeHtml(u)}</li>`).join('')}</ul>`
    : ''
  const audience = b.target_audience.length
    ? `<h4>Target audience</h4><p>${b.target_audience.map(escapeHtml).join(' · ')}</p>`
    : ''

  // b.name is the brand identity extracted from the site (may differ from
  // clients.name — e.g. brand "Roman Hu Real Estate" vs client "Roman Hu")
  return sectionShell('壹', '业务档案', `
<h4>Brand</h4><p><strong>${escapeHtml(b.name)}</strong></p>
<p class="lede">${escapeHtml(b.description)}</p>
${audience}
${usps}
`)
}

function diagnosisSection(report: DiscoveryReport): string {
  const d = report.diagnosis
  if (!d) return ''

  const scoresGrid = `
<div class="scores">
  ${scoreCell('SEO', d.scores.seo)}
  ${scoreCell('社媒', d.scores.social)}
  ${scoreCell('口碑', d.scores.reputation)}
  ${scoreCell('AI 可见度', d.scores.ai_visibility)}
  ${d.scores.ads !== undefined && d.scores.ads !== null ? scoreCell('广告', d.scores.ads) : ''}
  ${d.scores.competitor !== undefined && d.scores.competitor !== null ? scoreCell('竞品', d.scores.competitor) : ''}
</div>
`
  const actions = d.actions
  const actionBlock = (title: string, items: string[]): string =>
    items.length
      ? `<div class="action-block"><h4>${escapeHtml(title)}</h4><ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>`
      : ''

  return sectionShell('贰', '诊断结论', `
${d.crisis_type ? `<p class="crisis">⚠️ ${escapeHtml(d.crisis_type)}</p>` : ''}
<p class="lede">${escapeHtml(d.executive_summary)}</p>
${scoresGrid}
${d.key_finding ? `<p class="key-finding"><span class="label">核心发现 · </span>${escapeHtml(d.key_finding)}</p>` : ''}
${d.money_flow ? `<div class="money-flow"><h4>钱去了哪里</h4><p>${escapeHtml(d.money_flow)}</p></div>` : ''}
${actionBlock('立即可做', actions.quick_fix)}
${actionBlock('重要建设', actions.important)}
${actionBlock('需要专业支持', actions.talk_to_us)}
`)
}

function keywordsSection(report: DiscoveryReport): string {
  const kws = report.seed_keywords
  if (!kws.length) return ''
  const rows = kws.map(k => `
<tr>
  <td class="kw">${escapeHtml(k.keyword)}</td>
  <td class="type">${escapeHtml(k.type)}</td>
  <td class="num">${k.semrush_volume ?? k.estimated_volume ?? '—'}</td>
  <td class="num">${k.semrush_kd ?? '—'}</td>
  <td class="rationale">${escapeHtml(k.rationale)}</td>
</tr>`).join('')

  return sectionShell('叁', '种子关键词', `
<div class="table-scroll">
  <table>
    <thead><tr><th>关键词</th><th>类型</th><th>月搜索量</th><th>难度</th><th>理由</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
`)
}

function competitorsSection(report: DiscoveryReport): string {
  const comps = report.competitors
  if (!comps.length) return ''
  const rows = comps.map(c => `
<tr>
  <td class="brand">${escapeHtml(c.name)}<br><span class="domain-small">${escapeHtml(c.domain)}</span></td>
  <td class="type">${escapeHtml(c.relevance)}</td>
  <td class="num">${c.monthly_traffic ?? '—'}</td>
  <td class="rationale">${escapeHtml(c.rationale)}</td>
</tr>`).join('')

  return sectionShell('肆', '竞争对手', `
<div class="table-scroll">
  <table>
    <thead><tr><th>品牌</th><th>相关性</th><th>月访问</th><th>理由</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
`)
}

function aiVisibilitySection(report: DiscoveryReport): string {
  const results = report.ai_visibility_results ?? []
  const questions = report.ai_tracker_questions ?? []
  if (!results.length && !questions.length) return ''

  const testedBlock = results.length ? `
<h4>已测试问句 · ${results.length} 条</h4>
<ul class="vis-list">
${results.map(r => `
  <li>
    <div class="q">${escapeHtml(r.question)}</div>
    <div class="brands">出现的品牌：${r.top_brands.length ? r.top_brands.map(escapeHtml).join(' · ') : '无'}</div>
    <div class="mentioned ${r.client_mentioned ? 'yes' : 'no'}">${r.client_mentioned ? '✓ 客户品牌出现' : '✗ 客户品牌未出现'}</div>
  </li>`).join('')}
</ul>` : ''

  const questionBlock = questions.length ? `
<h4>建议追踪问句 · ${questions.length} 条</h4>
<ul>${questions.slice(0, 10).map(q => `<li><span class="cat">${escapeHtml(q.category)}</span> ${escapeHtml(q.question)}</li>`).join('')}</ul>
${questions.length > 10 ? `<p class="muted">…以及另 ${questions.length - 10} 条</p>` : ''}` : ''

  return sectionShell('伍', 'AI 可见度', `${testedBlock}${questionBlock}`)
}

// ─── v1.1 · Plugin merge sections ───────────────────────────────────────────

function localMediaSection(report: DiscoveryReport): string {
  const channels = report.local_media_channels
  if (!channels || channels.length === 0) return ''

  // Sort by roi_rank ascending (1 = must-do first), null last
  const sorted = [...channels].sort((a, b) => {
    const ra = a.roi_rank ?? 99
    const rb = b.roi_rank ?? 99
    return ra - rb
  })

  const rows = sorted.map(c => `
<article class="media-item">
  <div class="media-head">
    <h4>${escapeHtml(c.media_name)}</h4>
    <div class="media-tags">
      <span class="badge">${escapeHtml(mediaCategoryLabel(c.category))}</span>
      ${c.chinese_relevant ? '<span class="badge badge-gold">华人段</span>' : ''}
      ${c.roi_rank ? `<span class="badge badge-rank">ROI ${c.roi_rank}</span>` : ''}
    </div>
  </div>
  ${c.coverage_note ? `<p class="media-meta">覆盖 · ${escapeHtml(c.coverage_note)}</p>` : ''}
  ${c.reach_number ? `<p class="media-meta">Reach · ${c.reach_number.toLocaleString()} ${c.reach_metric ? `<span class="muted">(${escapeHtml(reachMetricLabel(c.reach_metric))})</span>` : ''}</p>` : ''}
  ${c.pricing_notes ? `<p class="media-meta">价格 · ${escapeHtml(c.pricing_notes)}</p>` : ''}
  ${c.recommended_play ? `<p class="media-play">🎯 ${escapeHtml(c.recommended_play)}</p>` : ''}
  ${c.contact_email || c.contact_phone || c.advertise_url ? `<p class="media-contact">
    ${c.contact_email ? `<a href="mailto:${escapeHtml(c.contact_email)}">${escapeHtml(c.contact_email)}</a>` : ''}
    ${c.contact_phone ? `<span class="muted"> · ${escapeHtml(c.contact_phone)}</span>` : ''}
    ${c.advertise_url ? ` · <a href="${escapeHtml(c.advertise_url)}">刊登信息 →</a>` : ''}
  </p>` : ''}
  ${c.traps_to_avoid && c.traps_to_avoid.length ? `<p class="media-trap">⚠️ ${c.traps_to_avoid.map(escapeHtml).join(' · ')}</p>` : ''}
</article>`).join('')

  return sectionShell('陆', '本地媒体渠道', `
<p class="lede muted">${sorted.length} 个建议渠道 · 按 ROI 优先级排序</p>
${rows}
`)
}

function marketContextSection(report: DiscoveryReport): string {
  const mc = report.market_context
  if (!mc) return ''

  const priceRows = mc.median_prices?.length ? `
<h4>Median 房价</h4>
<div class="table-scroll">
  <table>
    <thead><tr><th>Suburb</th><th>Median</th><th>As of</th></tr></thead>
    <tbody>${mc.median_prices.map(p => `
      <tr>
        <td>${escapeHtml(p.suburb)}</td>
        <td class="num">${p.median_price !== null ? `${p.currency ?? 'NZD'} ${p.median_price.toLocaleString()}` : '—'}</td>
        <td class="muted">${p.as_of ? escapeHtml(p.as_of) : '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>` : ''

  const schoolRows = mc.school_zones?.length ? `
<h4>学区</h4>
<ul>${mc.school_zones.map(sz => `
  <li><strong>${escapeHtml(sz.zone_name)}</strong>${sz.covered_suburbs?.length ? ` · ${sz.covered_suburbs.map(escapeHtml).join(', ')}` : ''}${sz.premium_note ? `<br><span class="muted">${escapeHtml(sz.premium_note)}</span>` : ''}</li>`).join('')}
</ul>` : ''

  const demo = mc.demographics
  const demoBlock = demo && (demo.chinese_ethnicity_pct !== null || demo.asian_ethnicity_pct !== null) ? `
<h4>人口结构</h4>
<p>
  ${demo.chinese_ethnicity_pct !== null && demo.chinese_ethnicity_pct !== undefined ? `华人占比 <strong>${demo.chinese_ethnicity_pct}%</strong>` : ''}
  ${demo.asian_ethnicity_pct !== null && demo.asian_ethnicity_pct !== undefined ? `${demo.chinese_ethnicity_pct ? ' · ' : ''}亚裔占比 <strong>${demo.asian_ethnicity_pct}%</strong>` : ''}
  ${demo.census_year ? `<span class="muted"> · ${demo.census_year} census</span>` : ''}
</p>` : ''

  const heat = mc.market_heat
  const heatBlock = heat ? `
<h4>市场热度</h4>
<p>
  ${heat.median_yoy_pct !== null && heat.median_yoy_pct !== undefined ? `Median YoY <strong class="${heat.median_yoy_pct >= 0 ? 'pos' : 'neg'}">${heat.median_yoy_pct > 0 ? '+' : ''}${heat.median_yoy_pct}%</strong>` : ''}
  ${heat.days_on_market ? ` · 平均 ${heat.days_on_market} 天成交` : ''}
  ${heat.buyer_or_seller_market ? ` · <strong>${escapeHtml(heat.buyer_or_seller_market)}</strong> market` : ''}
</p>` : ''

  const insights = mc.key_insights?.length ? `
<h4>战略洞察</h4>
<ul>${mc.key_insights.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''

  const gaps = mc.data_gaps?.length ? `
<p class="muted small">未能验证：${mc.data_gaps.map(escapeHtml).join(' · ')}</p>` : ''

  return sectionShell('柒', `区域市场速写 · ${escapeHtml(mc.region_name)}`, `
${mc.suburbs?.length ? `<p class="lede muted">${mc.suburbs.map(escapeHtml).join(' · ')}</p>` : ''}
${priceRows}
${schoolRows}
${demoBlock}
${heatBlock}
${insights}
${gaps}
`)
}

function sanityIssuesSection(report: DiscoveryReport): string {
  const issues = report.sanity_issues
  if (!issues || issues.length === 0) return ''

  const reds = issues.filter(i => i.severity === 'red')
  const yellows = issues.filter(i => i.severity === 'yellow')

  const renderIssue = (i: SanityIssue): string => `
<article class="sanity-item sanity-${i.severity}">
  <div class="sanity-head">
    <span class="badge badge-${i.severity}">${i.severity.toUpperCase()}</span>
    <span class="sanity-cat">${escapeHtml(sanityCategoryLabel(i.category))}</span>
    <code class="sanity-loc">${escapeHtml(i.location)}</code>
  </div>
  <p class="sanity-issue">${escapeHtml(i.issue)}</p>
  <p class="sanity-fix"><span class="muted">建议 · </span>${escapeHtml(i.fix_suggestion)}</p>
</article>`

  return sectionShell('捌', `数据质量提示 · ${reds.length} red / ${yellows.length} yellow`, `
<p class="muted small">FDE review 前请先处理红色标记 · 黄色标记按需修</p>
${reds.map(renderIssue).join('')}
${yellows.map(renderIssue).join('')}
`)
}

function notesSection(report: DiscoveryReport): string {
  if (!report.notes || report.notes.trim().length === 0) return ''
  return sectionShell('玖', '研究备注', `
<pre class="notes">${escapeHtml(report.notes)}</pre>
`)
}

function colophonSection(clientName: string, dateStr: string): string {
  return `<div class="colophon">
  <p><strong>Discovery Report · ${escapeHtml(clientName)}</strong></p>
  <p>生成于 ${escapeHtml(dateStr)} · Magic Engine · <span class="muted">confidential — for recipient review only</span></p>
</div>`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sectionShell(marker: string, title: string, body: string): string {
  return `<section>
<div class="section-head"><span class="marker">${marker}</span><h2>${escapeHtml(title)}</h2></div>
${body}
</section>`
}

function scoreCell(label: string, score: number): string {
  const color = score >= 70 ? 'good' : score >= 40 ? 'mid' : 'poor'
  return `<div class="score-cell"><div class="score-num ${color}">${score}</div><div class="score-label">${escapeHtml(label)}</div></div>`
}

function mediaCategoryLabel(cat: MediaChannelCategory): string {
  const map: Record<MediaChannelCategory, string> = {
    print_newspaper: '本地报刊',
    print_magazine: '本地杂志',
    community_fb_group: '社区 FB 群',
    neighbourly: 'Neighbourly',
    newsletter_edm: 'Newsletter EDM',
    podcast: '播客',
    youtube_channel: 'YouTube 频道',
    radio: '电台',
    tv: '电视',
    sponsorship_event: '活动赞助',
    chinese_media: '华人媒体',
    school_publication: '学校刊物',
    business_association: '商会',
    other: '其他',
  }
  return map[cat] ?? cat
}

function reachMetricLabel(metric: string): string {
  const map: Record<string, string> = {
    print_circulation: '印刷发行',
    readers_nielsen: 'Nielsen 读者数',
    fb_members: 'FB 群成员',
    email_subs: '邮件订阅',
    podcast_downloads: '播客下载',
    tv_viewers: '电视收视',
    unknown: '未知',
  }
  return map[metric] ?? metric
}

function sanityCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    fabricated_number: '编数字',
    unmarked_uncertainty: '未标不确定',
    cross_geography: '跨地理',
    weakness_omitted: '短板遗漏',
    other: '其他',
  }
  return map[cat] ?? cat
}

/** Escape HTML — never trust LLM string output. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Styles (inline · Roman-deck-inspired editorial serif) ───────────────────

const STYLES = `
:root {
  --ground: #F8F6F0;
  --paper: #FFFFFF;
  --ink: #14171C;
  --muted: #6C6F76;
  --deep: #002542;
  --gold: #A88342;
  --gold-soft: #FFF7E0;
  --hairline: #E5E3DB;
  --signal: #C63A21;
  --pos: #2E6B4A;
  --neg: #C63A21;
  --font-display: Charter, 'Iowan Old Style', 'Songti SC', 'Noto Serif SC', 'Times New Roman', serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Inter, sans-serif;
  --font-mono: 'SF Mono', 'JetBrains Mono', Menlo, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
.wrap {
  max-width: 780px;
  margin: 0 auto;
  padding: clamp(40px, 6vw, 80px) clamp(20px, 4vw, 44px);
}
.cover {
  padding-bottom: 32px;
  border-bottom: 2px solid var(--ink);
  margin-bottom: 40px;
}
.cover .kicker {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 10px;
}
.cover h1 {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: clamp(32px, 5vw, 44px);
  line-height: 1.1;
  letter-spacing: -0.015em;
  margin: 0 0 8px;
  color: var(--deep);
}
.cover .domain {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 4px;
}
.cover .date {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 20px;
}
.cover .stat {
  display: flex;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 14px;
}
.cover .stat .label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  min-width: 100px;
}
.cover .stat .value {
  color: var(--ink);
  font-weight: 500;
}
section {
  margin-top: 44px;
  padding-top: 24px;
  border-top: 1px solid var(--hairline);
}
section:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
.section-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 18px;
}
.marker {
  font-family: var(--font-display);
  font-size: 24px;
  color: var(--gold);
  font-weight: 400;
}
h2 {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 22px;
  line-height: 1.25;
  letter-spacing: -0.005em;
  color: var(--deep);
  margin: 0;
}
h4 {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--gold);
  margin: 22px 0 8px;
}
p { margin: 0 0 12px; }
ul, ol { padding-left: 20px; margin: 6px 0 16px; }
li { margin-bottom: 6px; }
strong { color: var(--ink); font-weight: 600; }
em { font-style: italic; }
a { color: var(--deep); text-decoration: underline; text-underline-offset: 3px; }
code { font-family: var(--font-mono); font-size: 12px; background: var(--hairline); padding: 1px 6px; border-radius: 3px; }
.muted { color: var(--muted); }
.small { font-size: 12.5px; }
.lede { font-family: var(--font-display); font-size: 17px; line-height: 1.55; color: var(--ink); }
.crisis {
  padding: 10px 14px;
  background: rgba(198,58,33,0.08);
  border-left: 3px solid var(--signal);
  color: var(--signal);
  font-weight: 600;
  margin-bottom: 16px;
}
.scores {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
  gap: 12px;
  margin: 16px 0 20px;
  padding: 16px;
  background: var(--paper);
  border: 1px solid var(--hairline);
}
.score-cell { text-align: center; }
.score-num {
  font-family: var(--font-display);
  font-size: 30px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  line-height: 1;
}
.score-num.good { color: var(--pos); }
.score-num.mid { color: var(--gold); }
.score-num.poor { color: var(--signal); }
.score-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-top: 4px;
}
.key-finding {
  padding: 12px 16px;
  background: var(--gold-soft);
  border-left: 3px solid var(--gold);
  margin: 12px 0;
}
.key-finding .label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gold);
  font-weight: 600;
}
.money-flow { margin: 16px 0; }
.action-block { margin: 12px 0; }
.table-scroll { overflow-x: auto; margin: 14px -4px; padding: 0 4px; }
table {
  width: 100%;
  min-width: 500px;
  border-collapse: collapse;
  font-size: 13.5px;
}
th, td {
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid var(--hairline);
  vertical-align: top;
}
th {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 500;
  border-bottom: 1.5px solid var(--ink);
  padding-bottom: 10px;
}
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.kw { font-weight: 500; color: var(--ink); }
td.type { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
td.rationale { color: var(--muted); font-size: 13px; }
td.brand { font-weight: 500; color: var(--ink); }
.domain-small { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.vis-list { list-style: none; padding: 0; }
.vis-list li {
  padding: 12px 14px;
  margin-bottom: 8px;
  background: var(--paper);
  border-left: 3px solid var(--hairline);
}
.vis-list .q { font-weight: 500; margin-bottom: 6px; }
.vis-list .brands { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
.vis-list .mentioned { font-family: var(--font-mono); font-size: 11px; }
.vis-list .mentioned.yes { color: var(--pos); }
.vis-list .mentioned.no { color: var(--signal); }
.cat {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--gold);
  margin-right: 6px;
}
.media-item {
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--paper);
  border-left: 3px solid var(--gold);
}
.media-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
.media-head h4 { margin: 0; color: var(--deep); text-transform: none; font-size: 16px; letter-spacing: 0; font-family: var(--font-display); font-weight: 500; }
.media-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.05em;
  background: var(--hairline);
  color: var(--ink);
  border-radius: 2px;
}
.badge-gold { background: var(--gold); color: var(--paper); }
.badge-rank { background: var(--deep); color: var(--paper); }
.badge-red { background: var(--signal); color: var(--paper); }
.badge-yellow { background: var(--gold); color: var(--paper); }
.media-meta { font-size: 13px; color: var(--muted); margin: 2px 0; }
.media-play { font-size: 13.5px; margin: 8px 0; color: var(--ink); }
.media-contact { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
.media-trap { font-size: 12.5px; color: var(--signal); margin-top: 4px; }
.pos { color: var(--pos); }
.neg { color: var(--signal); }
.sanity-item {
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--paper);
  border-left: 3px solid var(--hairline);
}
.sanity-red { border-left-color: var(--signal); }
.sanity-yellow { border-left-color: var(--gold); }
.sanity-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; }
.sanity-cat { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.sanity-loc { font-family: var(--font-mono); font-size: 11px; }
.sanity-issue { font-size: 13.5px; margin: 4px 0; }
.sanity-fix { font-size: 12.5px; color: var(--muted); margin: 0; }
.notes {
  font-family: var(--font-body);
  font-size: 13px;
  white-space: pre-wrap;
  padding: 14px;
  background: var(--paper);
  border-left: 3px solid var(--hairline);
  color: var(--ink);
  margin: 0;
}
.colophon {
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid var(--hairline);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}
@media print {
  body { background: white; font-size: 11pt; }
  section { page-break-inside: avoid; padding-top: 20px; }
  .scores { break-inside: avoid; }
  a { color: var(--ink); text-decoration: none; }
}
`
