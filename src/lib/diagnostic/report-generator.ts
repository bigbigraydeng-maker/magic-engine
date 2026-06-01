/**
 * Report Composer — P8.10.S4.1
 *
 * Aggregates a completed diagnostic run + persisted Synthesis narratives +
 * prescription into three artifacts:
 *
 *   1. markdown — full report (executive summary, baseline, 6 dimensions,
 *                 competitor analysis, market context, prescription)
 *   2. html     — printable, self-contained HTML document (inline CSS,
 *                 @page rules, page-break hints for major sections)
 *   3. evidence — separate JSON file (raw findings + narrative metadata),
 *                 NOT inlined into the report (per S4.1 spec)
 *
 * Prescription source preference:
 *   - read latest row from `prescriptions` table by (run_id, client_id)
 *   - if missing AND caller supplied `intake` → fall back to
 *     generatePrescription (which itself writes a draft row)
 *   - if missing AND no intake → omit the prescription section
 *
 * Narrative sections are omitted when their bucket is empty (same convention
 * as the prescription-generator prompt builder in S3.6).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DiagnosticRun,
  DiagnosticFinding,
  DiagnosticDimension,
  PrescriptionContent,
  PrescriptionIntake,
} from '@/types/diagnostic'
import {
  loadNarrativesForRun,
  type NarrativeRow,
  type NarrativeKind,
} from './synthesis/persistence'
import { extractEvidenceRefs } from './types'
import { generatePrescription } from './prescription-generator'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReportArtifacts {
  markdown: string
  html: string
  evidence: { filename: string; json: string }
}

export interface GenerateReportOptions {
  /**
   * Used only when the prescriptions table has no row for (run_id, client_id).
   * When provided, the composer calls generatePrescription as a fallback.
   * When omitted, the prescription section is silently dropped.
   */
  intake?: PrescriptionIntake
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CITE_CSS = `
sup.cite { cursor: pointer; color: #1a5fb4; font-size: .72em; vertical-align: super; padding: 0 3px; border-radius: 3px; background: #e8f0fe; user-select: none; font-weight: 600; }
sup.cite:hover, sup.cite:focus { background: #c5d8fc; outline: 1px solid #1a5fb4; outline-offset: 1px; }
`

const CITE_JS = `<script>
(function(){
  var d=document.getElementById('__cite_data__');
  if(!d)return;
  var data=JSON.parse(d.textContent||'{}');
  function fire(el){
    var idx=el.getAttribute('data-idx');
    var refs=data[idx]||[];
    if(window.parent!==window)window.parent.postMessage({type:'cite:click',idx:idx,refs:refs},'*');
  }
  document.addEventListener('click',function(e){
    var el=e.target&&e.target.closest?e.target.closest('.cite'):null;
    if(el){e.preventDefault();fire(el);}
  });
  document.addEventListener('keydown',function(e){
    if((e.key==='Enter'||e.key===' ')&&document.activeElement&&document.activeElement.classList.contains('cite')){
      e.preventDefault();fire(document.activeElement);
    }
  });
})();
</script>`

const DIMENSION_LABELS: Record<DiagnosticDimension, string> = {
  seo:           'SEO',
  ai_visibility: 'AI 可见度',
  ads:           '广告',
  social:        '社媒',
  reputation:    '口碑',
  competitor:    '竞品',
}

const DIMENSION_ORDER: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'social', 'reputation', 'competitor', 'ads',
]

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  medium:   'MEDIUM',
  low:      'LOW',
  info:     'INFO',
}

// ---------------------------------------------------------------------------
// Citation helpers
// ---------------------------------------------------------------------------

function buildCitationRegistry(
  narratives: NarrativeRow[],
): Map<string, { idx: number; refs: string[] }> {
  const grouped = new Map<string, string[]>()
  for (const n of narratives) {
    const refs = n.evidence_refs ?? []
    if (refs.length === 0) continue
    const key = `${n.kind}:${n.dimension ?? ''}`
    const existing = grouped.get(key) ?? []
    grouped.set(key, [...existing, ...refs])
  }
  const registry = new Map<string, { idx: number; refs: string[] }>()
  let counter = 0
  for (const [key, refs] of grouped) {
    registry.set(key, { idx: ++counter, refs })
  }
  return registry
}

function injectCitationSups(
  html: string,
  registry: Map<string, { idx: number; refs: string[] }>,
): string {
  if (registry.size === 0) return html
  const result = html.replace(
    /\[\[cite:([^:]+):([^\]]*)\]\]/g,
    (_, kind: string, dim: string) => {
      const entry = registry.get(`${kind}:${dim}`)
      if (!entry) return ''
      return `<sup class="cite" data-idx="${entry.idx}" tabindex="0">[${entry.idx}]</sup>`
    },
  )
  return result.replace(/<p>\s*<\/p>/g, '')
}

function buildCitationJsonData(
  registry: Map<string, { idx: number; refs: string[] }>,
): string | null {
  if (registry.size === 0) return null
  const data: Record<string, string[]> = {}
  for (const { idx, refs } of Array.from(registry.values())) {
    data[String(idx)] = refs
  }
  return JSON.stringify(data)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function generateReport(
  supabase: SupabaseClient,
  runId: string,
  clientId: string,
  opts: GenerateReportOptions = {},
): Promise<ReportArtifacts> {
  const [runRes, clientRes, findingsRes, narratives] = await Promise.all([
    supabase
      .from('diagnostic_runs')
      .select('*')
      .eq('id', runId)
      .single(),
    supabase
      .from('clients')
      .select('id, name, domain')
      .eq('id', clientId)
      .single(),
    supabase
      .from('diagnostic_findings')
      .select('*')
      .eq('run_id', runId)
      .eq('client_id', clientId)
      .order('priority_score', { ascending: false }),
    loadNarrativesForRun(supabase, runId),
  ])

  if (runRes.error || !runRes.data) {
    throw new Error(
      `Report: diagnostic run not found (${runId}): ${runRes.error?.message ?? 'no data'}`,
    )
  }

  const run = runRes.data as DiagnosticRun
  const client = (clientRes.data ?? {
    id: clientId,
    name: clientId,
    domain: null,
  }) as { id: string; name: string; domain: string | null }
  const findings = (findingsRes.data ?? []) as DiagnosticFinding[]

  const prescription = await loadOrGeneratePrescription(
    supabase,
    runId,
    clientId,
    opts.intake,
  )

  const markdown = composeMarkdown({ run, client, findings, narratives, prescription })
  const html     = composeHtml({ run, client, findings, narratives, prescription, markdown })
  const evidence = composeEvidence({ run, client, findings, narratives, prescription })

  return { markdown, html, evidence }
}

// ---------------------------------------------------------------------------
// Prescription loader (DB first, fallback to live generation)
// ---------------------------------------------------------------------------

async function loadOrGeneratePrescription(
  supabase: SupabaseClient,
  runId: string,
  clientId: string,
  intake: PrescriptionIntake | undefined,
): Promise<PrescriptionContent | null> {
  const { data } = await supabase
    .from('prescriptions')
    .select('content, generated_at')
    .eq('run_id', runId)
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const content = (data as { content?: PrescriptionContent } | null)?.content
  if (content) return content
  if (!intake) return null

  try {
    const result = await generatePrescription(supabase, runId, clientId, intake)
    return result.content
  } catch (err) {
    console.warn('[report-generator] live prescription generation failed:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface ComposeInput {
  run: DiagnosticRun
  client: { id: string; name: string; domain: string | null }
  findings: DiagnosticFinding[]
  narratives: NarrativeRow[]
  prescription: PrescriptionContent | null
}

function buildMarkdownParts(input: ComposeInput): string[] {
  const { run, client, findings, narratives, prescription } = input
  const buckets = bucketNarratives(narratives)
  const parts: string[] = []

  parts.push(renderTitleMd(run, client))
  parts.push(renderSummaryMd(run, prescription, buckets))
  parts.push(renderBaselineMd(run))
  parts.push(renderDimensionsMd(run, findings, buckets))

  const competitor = renderCompetitorMd(buckets)
  if (competitor) parts.push(competitor)

  const market = renderMarketContextMd(buckets)
  if (market) parts.push(market)

  if (prescription) parts.push(renderPrescriptionMd(prescription))

  return parts
}

function composeMarkdown(input: ComposeInput): string {
  const raw = buildMarkdownParts(input).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  // strip cite markers — they are for HTML only
  return raw.replace(/\[\[cite:[^\]]+\]\]\n?/g, '')
}

// ── Markdown sections ────────────────────────────────────────────────────────

function renderTitleMd(
  run: DiagnosticRun,
  client: { name: string; domain: string | null },
): string {
  const completedAt = run.completed_at ?? run.created_at
  const domain = client.domain ? ` · ${client.domain}` : ''
  return [
    '# 诊断报告',
    '',
    `**${client.name}**${domain}`,
    '',
    `生成时间：${formatDate(completedAt)} · Run ID：\`${run.id}\``,
  ].join('\n')
}

function renderSummaryMd(
  run: DiagnosticRun,
  prescription: PrescriptionContent | null,
  buckets: ReturnType<typeof bucketNarratives>,
): string {
  const score = run.overall_score ?? '—'
  const verdict = scoreVerdict(run.overall_score)
  const lead = prescription?.summary
    ?? (buckets.market_context[0]?.narrative_md.split('\n')[0])
    ?? '本次诊断完成，详见下方维度详情与处方。'

  return [
    '## 摘要',
    '',
    `- 综合得分：**${score}/100** （${verdict}）`,
    `- 关键发现：${run.critical_count} 项 critical · ${run.high_count} 项 high`,
    '',
    lead,
  ].join('\n')
}

function renderBaselineMd(run: DiagnosticRun): string {
  const rows = DIMENSION_ORDER.map(dim => {
    const score = run.dimension_scores?.[dim]
    const display = score == null ? '无数据' : `${score}/100`
    return `| ${DIMENSION_LABELS[dim]} | ${display} |`
  }).join('\n')

  return [
    '## 基线快照',
    '',
    '| 维度 | 得分 |',
    '| --- | --- |',
    rows,
  ].join('\n')
}

function renderDimensionsMd(
  run: DiagnosticRun,
  findings: DiagnosticFinding[],
  buckets: ReturnType<typeof bucketNarratives>,
): string {
  const sections: string[] = ['## 维度详情', '']

  for (const dim of DIMENSION_ORDER) {
    const score = run.dimension_scores?.[dim]
    const scoreDisplay = score == null ? '无数据' : `${score}/100`
    sections.push(`### ${DIMENSION_LABELS[dim]} — ${scoreDisplay}`)

    const explanation = buckets.score_explanation.find(n => n.dimension === dim)
    if (explanation) {
      sections.push('', '**得分解释**', '', explanation.narrative_md)
      if ((explanation.evidence_refs?.length ?? 0) > 0) {
        sections.push(`[[cite:score_explanation:${dim}]]`)
      }
    }

    const narrative = buckets.dimension_narrative.find(n => n.dimension === dim)
    if (narrative) {
      sections.push('', '**叙事分析**', '', narrative.narrative_md)
      if ((narrative.evidence_refs?.length ?? 0) > 0) {
        sections.push(`[[cite:dimension_narrative:${dim}]]`)
      }
    }

    const dimFindings = findings.filter(f => f.dimension === dim)
    if (dimFindings.length > 0) {
      sections.push('', '**关键问题**', '')
      for (const f of dimFindings.slice(0, 5)) {
        const sev = SEVERITY_LABEL[f.severity] ?? f.severity
        sections.push(`- [${sev}] **${f.title}** — ${f.recommendation}`)
      }
    }

    sections.push('')
  }

  return sections.join('\n').trim()
}

function renderCompetitorMd(buckets: ReturnType<typeof bucketNarratives>): string | null {
  const ms = buckets.competitor_market_structure
  const bp = buckets.competitor_benchmarking_path
  if (ms.length === 0 && bp.length === 0) return null

  const parts: string[] = ['## 竞品分析', '']
  if (ms.length > 0) {
    parts.push('### 市场结构', '', ms.map(n => n.narrative_md).join('\n\n'), '')
    const msRefs = ms.flatMap(n => n.evidence_refs ?? [])
    if (msRefs.length > 0) parts.push(`[[cite:competitor_market_structure:competitor]]`)
  }
  if (bp.length > 0) {
    parts.push('### 对标路径', '', bp.map(n => n.narrative_md).join('\n\n'), '')
    const bpRefs = bp.flatMap(n => n.evidence_refs ?? [])
    if (bpRefs.length > 0) parts.push(`[[cite:competitor_benchmarking_path:competitor]]`)
  }
  return parts.join('\n').trim()
}

function renderMarketContextMd(buckets: ReturnType<typeof bucketNarratives>): string | null {
  if (buckets.market_context.length === 0) return null
  const lines: string[] = [
    '## 市场上下文',
    '',
    buckets.market_context.map(n => n.narrative_md).join('\n\n'),
  ]
  const mcRefs = buckets.market_context.flatMap(n => n.evidence_refs ?? [])
  if (mcRefs.length > 0) lines.push(`[[cite:market_context:]]`)
  return lines.join('\n')
}

function renderPrescriptionMd(p: PrescriptionContent): string {
  const lines: string[] = ['## 处方建议', '', p.summary, '']

  for (const phase of p.phases) {
    lines.push(
      `### ${phase.name} （${phase.duration_weeks} 周）`,
      '',
    )
    if (phase.actions.length === 0) {
      lines.push('_暂无动作_', '')
      continue
    }
    for (const a of phase.actions) {
      lines.push(
        `- **${a.title}** [${DIMENSION_LABELS[a.dimension] ?? a.dimension}] ` +
          `· effort: ${a.effort} · impact: ${a.impact}`,
        `  ${a.description}`,
      )
    }
    lines.push('')
  }

  if (p.kpi_targets.length > 0) {
    lines.push('### KPI 目标', '')
    lines.push('| 指标 | 当前 | 目标 | 单位 |', '| --- | --- | --- | --- |')
    for (const k of p.kpi_targets) {
      lines.push(
        `| ${k.metric} | ${k.current_value ?? '—'} | ${k.target_value} | ${k.unit} |`,
      )
    }
    lines.push('')
  }

  if (p.budget_allocation.length > 0) {
    lines.push('### 预算分配', '')
    lines.push('| 维度 | 金额 (AUD) | 占比 |', '| --- | --- | --- |')
    for (const b of p.budget_allocation) {
      const label = DIMENSION_LABELS[b.dimension] ?? b.dimension
      lines.push(`| ${label} | ${b.amount_aud} | ${b.percentage}% |`)
    }
  }

  return lines.join('\n').trim()
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function composeHtml(
  input: ComposeInput & { markdown: string },
): string {
  const title = `诊断报告 — ${input.client.name}`

  // Build citation registry from narratives with evidence_refs
  const citRegistry = buildCitationRegistry(input.narratives)

  // Use fresh markdown with [[cite:...]] markers (not the stripped markdown artifact)
  const mdWithCite = buildMarkdownParts(input).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  let body = mdToHtml(mdWithCite)
  body = injectCitationSups(body, citRegistry)

  const citData = buildCitationJsonData(citRegistry)

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    PRINT_CSS + CITE_CSS,
    '</style>',
    '</head>',
    '<body>',
    '<main class="report">',
    body,
    '</main>',
    citData ? `<script id="__cite_data__" type="application/json">${citData}</script>` : '',
    citData ? CITE_JS : '',
    '<script>window.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="p"){/* print shortcut already handled by browser */}})</script>',
    '</body>',
    '</html>',
  ].join('\n')
}

const PRINT_CSS = `
:root { --fg: #111; --muted: #555; --rule: #ddd; --accent: #1a5fb4; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; }
.report { max-width: 880px; margin: 0 auto; }
h1 { font-size: 1.8rem; border-bottom: 2px solid var(--accent); padding-bottom: .4rem; }
h2 { font-size: 1.4rem; margin-top: 2rem; border-bottom: 1px solid var(--rule); padding-bottom: .3rem; }
h3 { font-size: 1.15rem; margin-top: 1.4rem; color: var(--accent); }
h4 { font-size: 1rem; margin-top: 1rem; }
p { margin: .6rem 0; }
ul, ol { padding-left: 1.4rem; }
li { margin: .2rem 0; }
strong { color: #000; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .95rem; }
th, td { border: 1px solid var(--rule); padding: .4rem .6rem; text-align: left; }
th { background: #f5f5f5; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; font-size: .9em; }
@page { size: A4; margin: 2cm; }
@media print {
  body { padding: 0; }
  h2 { page-break-before: auto; break-before: auto; }
  h2:not(:first-of-type) { page-break-before: always; break-before: page; }
  h3, h4 { page-break-after: avoid; break-after: avoid; }
  table, ul, ol { page-break-inside: avoid; break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}
`

// ---------------------------------------------------------------------------
// Minimal Markdown → HTML converter
//
// Handles only the subset emitted by this composer + the narrative_md output
// produced by Synthesis (headings #/##/###/####, paragraphs, bold/italic,
// inline code, bullet lists, ordered lists, GitHub-flavor tables with a
// header + separator row). Anything richer is escaped as plain text.
// ---------------------------------------------------------------------------

function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/)
  const out: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // blank line
    if (line.trim() === '') { i++; continue }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = Math.min(h[1].length, 6)
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`)
      i++; continue
    }

    // table: header line | separator line | body lines
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = parseTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseTableRow(lines[i]))
        i++
      }
      out.push(renderTable(header, rows))
      continue
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      out.push('<ul>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ul>')
      continue
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      out.push('<ol>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ol>')
      continue
    }

    // paragraph (consume until blank line)
    const buf: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6})\s+/.test(lines[i])
           && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${renderInline(buf.join(' '))}</p>`)
  }

  return out.join('\n')
}

function renderInline(text: string): string {
  let s = escapeHtml(text)
  // bold then italic (order matters to avoid nesting clashes)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  return s
}

function parseTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map(c => c.trim())
}

function renderTable(header: string[], rows: string[][]): string {
  const th = header.map(c => `<th>${renderInline(c)}</th>`).join('')
  const trs = rows
    .map(r => '<tr>' + r.map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>')
    .join('')
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Evidence JSON (separate artifact, not embedded)
// ---------------------------------------------------------------------------

function composeEvidence(input: ComposeInput): { filename: string; json: string } {
  const { run, client, findings, narratives } = input
  const payload = {
    run_id:      run.id,
    client_id:   client.id,
    domain:      client.domain,
    generated_at: new Date().toISOString(),
    overall_score: run.overall_score,
    dimension_scores: run.dimension_scores,
    findings: findings.map(f => ({
      ...f,
      evidence_refs: extractEvidenceRefs(f.evidence),
    })),
    narratives: narratives.map(n => ({
      id: n.id,
      kind: n.kind,
      dimension: n.dimension,
      evidence_refs: n.evidence_refs,
      model: n.model,
      cost_usd: n.cost_usd,
      generated_at: n.generated_at,
      metadata: n.metadata,
    })),
  }
  return {
    filename: `evidence-${run.id}.json`,
    json: JSON.stringify(payload, null, 2),
  }
}

// ---------------------------------------------------------------------------
// Narrative bucketing — identical convention to prescription-generator S3.6
// ---------------------------------------------------------------------------

function bucketNarratives(narratives: NarrativeRow[]): Record<NarrativeKind, NarrativeRow[]> {
  const buckets: Record<NarrativeKind, NarrativeRow[]> = {
    market_context: [],
    competitor_market_structure: [],
    competitor_benchmarking_path: [],
    dimension_narrative: [],
    score_explanation: [],
  }
  for (const n of narratives) {
    if (buckets[n.kind]) buckets[n.kind].push(n)
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  } catch {
    return iso
  }
}

function scoreVerdict(score: number | null): string {
  if (score == null) return '未评分'
  if (score >= 80) return '健康'
  if (score >= 60) return '一般'
  if (score >= 40) return '偏弱'
  return '亟需修复'
}
