/**
 * Client work digest — PREVIEW ONLY read path (Issue #1113 GO BUILD v0).
 *
 * Frozen scope per Build Control: read `fde_work_logs` for one client over a
 * time window and render a local, un-sent preview. No new table, no cron, no
 * event kernel, no email provider call — this is a thin one-off command, not
 * a platform capability (see me-platform-tier-gate judgement on the PR).
 *
 * Section tags are passed through verbatim from the source `【Tag】` markers —
 * never remapped onto the six pillars — so a tag only ever appears when the
 * source text says so explicitly. An empty window renders NO_SOURCE_EVIDENCE
 * rather than inventing content.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface WorkLogRow {
  id: string
  client_id: string
  log_date: string
  summary: string
  author_email: string
  created_at: string
}

export interface DigestEvent {
  workLogId: string
  logDate: string
  occurredAt: string
  /** Verbatim source bracket tag (e.g. "SEO", "GEO", "GBP"), or null when the
   *  summary carried no 【...】 marker for this text. */
  sourceTag: string | null
  headline: string
  body: string
}

export interface DigestWindow {
  start: string
  end: string
  hours: number
}

export interface DigestReceipt {
  clientId: string
  window: DigestWindow
  senderDisplay: string
  eventCount: number
  events: DigestEvent[]
  status: 'ok' | 'NO_SOURCE_EVIDENCE'
}

export interface PreviewResult {
  html: string
  receipt: DigestReceipt
}

const NEXT_STEP_RE = /下一步[：:]/
const BRACKET_RE = /【([^】]+)】/g
const HEADLINE_MAX = 120

interface RawSection {
  tag: string | null
  text: string
}

/** Split a `fde_work_logs.summary` into its 【tag】 sections, verbatim. */
export function splitSections(summary: string): RawSection[] {
  const markers: { tag: string; start: number; contentStart: number }[] = []

  BRACKET_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = BRACKET_RE.exec(summary))) {
    markers.push({ tag: m[1].trim(), start: m.index, contentStart: m.index + m[0].length })
  }

  const nsMatch = NEXT_STEP_RE.exec(summary)
  if (nsMatch) {
    markers.push({
      tag: '下一步',
      start: nsMatch.index,
      contentStart: nsMatch.index + nsMatch[0].length,
    })
  }

  markers.sort((a, b) => a.start - b.start)

  if (markers.length === 0) {
    const text = summary.trim()
    return text ? [{ tag: null, text }] : []
  }

  const sections: RawSection[] = []
  const lead = summary.slice(0, markers[0].start).trim()
  if (lead) sections.push({ tag: null, text: lead })

  for (let i = 0; i < markers.length; i++) {
    const end = i + 1 < markers.length ? markers[i + 1].start : summary.length
    const text = summary.slice(markers[i].contentStart, end).trim()
    if (text) sections.push({ tag: markers[i].tag, text })
  }
  return sections
}

/** First sentence of a section, capped at 120 chars so the preview stays
 *  scannable — never the full body. */
export function firstHeadline(text: string, maxLen = HEADLINE_MAX): string {
  const stopIdx = text.search(/[。；;\n]/)
  const raw = (stopIdx >= 0 ? text.slice(0, stopIdx) : text).trim() || text.trim()
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw
}

/** Turn raw `fde_work_logs` rows into digest events, one per parsed section.
 *  Every event keeps its source row id + timestamp untouched. */
export function buildDigestEvents(rows: WorkLogRow[]): DigestEvent[] {
  const events: DigestEvent[] = []
  for (const row of rows) {
    for (const section of splitSections(row.summary)) {
      events.push({
        workLogId: row.id,
        logDate: row.log_date,
        occurredAt: row.created_at,
        sourceTag: section.tag,
        headline: firstHeadline(section.text),
        body: section.text,
      })
    }
  }
  return events
}

/** Default preview window: the N hours ending at `now`. */
export function computeWindow(now: Date, hours = 24): DigestWindow {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`hours must be a positive number, got ${hours}`)
  }
  const end = now
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString(), hours }
}

export interface FetchWorkLogsResult {
  rows: WorkLogRow[]
  error?: string
}

/** Read `fde_work_logs` scoped to exactly one client and one time window.
 *  The `.eq('client_id', ...)` here is what keeps this cross-client-safe —
 *  every row returned belongs to the requested client, nothing else. */
export async function fetchWorkLogsForPreview(
  sb: SupabaseClient,
  clientId: string,
  window: DigestWindow,
): Promise<FetchWorkLogsResult> {
  const { data, error } = await sb
    .from('fde_work_logs')
    .select('id, client_id, log_date, summary, author_email, created_at')
    .eq('client_id', clientId)
    .gte('created_at', window.start)
    .lt('created_at', window.end)
    .order('created_at', { ascending: true })

  if (error) return { rows: [], error: error.message }
  return { rows: (data ?? []) as WorkLogRow[] }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function groupByTag(events: DigestEvent[]): { tag: string | null; items: DigestEvent[] }[] {
  const order: (string | null)[] = []
  const groups = new Map<string | null, DigestEvent[]>()
  for (const ev of events) {
    if (!groups.has(ev.sourceTag)) {
      groups.set(ev.sourceTag, [])
      order.push(ev.sourceTag)
    }
    groups.get(ev.sourceTag)!.push(ev)
  }
  return order.map((tag) => ({ tag, items: groups.get(tag)! }))
}

function renderShell(clientId: string, window: DigestWindow, senderDisplay: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Magic Engine 客户摘要预览（未发送）</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2a2a2a;line-height:1.6;max-width:640px;margin:0 auto;padding:24px">
<div style="background:#fff3cd;border:1px solid #ffe69c;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-weight:600">
⚠️ PREVIEW ONLY — 本页从未发送，也不会自动发送。Sender（仅展示）：${escapeHtml(senderDisplay)}
</div>
<p style="color:#666;font-size:13px">客户：${escapeHtml(clientId)} · 窗口：${escapeHtml(window.start)} → ${escapeHtml(window.end)}（${window.hours}h）</p>
<div style="background:#eef2ff;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:13px;color:#333">
以下条目全部来自 <code>fde_work_logs</code> 的执行记录（work done）。<strong>Outcome 状态：UNKNOWN</strong> ——
本预览不做任何结果 / 六大支柱评分的验证声明，标签仅在来源明确写出时才显示。
</div>
${body}
</body></html>`
}

/** Render the HTML preview + a structured, source-traceable receipt. Zero
 *  events renders NO_SOURCE_EVIDENCE rather than inventing anything. */
export function renderPreview(
  clientId: string,
  window: DigestWindow,
  events: DigestEvent[],
  senderDisplay: string,
): PreviewResult {
  const status: DigestReceipt['status'] = events.length === 0 ? 'NO_SOURCE_EVIDENCE' : 'ok'
  const receipt: DigestReceipt = {
    clientId,
    window,
    senderDisplay,
    eventCount: events.length,
    events,
    status,
  }

  if (status === 'NO_SOURCE_EVIDENCE') {
    const body = `<p><strong>NO_SOURCE_EVIDENCE</strong> — 过去 ${window.hours} 小时内没有 fde_work_logs 记录，预览为空，不补写内容。</p>`
    return { html: renderShell(clientId, window, senderDisplay, body), receipt }
  }

  const body = groupByTag(events)
    .map(
      ({ tag, items }) => `<section style="margin-bottom:16px">
<h3 style="font-size:14px;color:#555;margin:0 0 8px">${escapeHtml(tag ?? '未分类')}</h3>
<ul style="margin:0;padding-left:20px">
${items
  .map(
    (ev) => `<li style="margin-bottom:8px">
<p style="margin:0;font-weight:600">${escapeHtml(ev.headline)}</p>
<p style="margin:0;color:#888;font-size:12px">来源：fde_work_logs #${escapeHtml(ev.workLogId)} · ${escapeHtml(ev.logDate)}（${escapeHtml(ev.occurredAt)}）</p>
</li>`,
  )
  .join('\n')}
</ul>
</section>`,
    )
    .join('\n')

  return { html: renderShell(clientId, window, senderDisplay, body), receipt }
}
