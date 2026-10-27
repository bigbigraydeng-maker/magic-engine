import type { KPITarget, PrescriptionContent, PrescriptionIntake, PrescriptionPhase } from '@/types/diagnostic'
import { formatAdMoney } from '@/lib/ads/spend-figures'

export const CHAT_NOTE = '这段对话刷新后会清空，处方会留下。'
export const FULL_TEXT_LABEL = '看处方全文'
export const FORMULA_LABEL = '怎么算的'
export const UNREADABLE = '读不到'

const STATUS_BADGE: Record<string, string> = {
  draft: '草稿',
  approved: '已同意',
  rejected: '已退回',
  superseded: '已换新版',
  generating: '正在写',
  failed: '没写成',
}

const MARKER_RE = /（\d+）|\(\d+\)|[①②③④⑤⑥⑦⑧⑨⑩]/g
const FORMULA_HINT = /[=×÷≈]|按当前数据算/
const CALC_NOTE = /（[^）]*(?:按当前数据算|[×÷≈])[^）]*）/

export function statusBadge(status: string | null): string {
  if (!status) return UNREADABLE
  return STATUS_BADGE[status] ?? UNREADABLE
}

/** Same condition the agree / reject buttons already use. */
export function approveActionsVisible(status: string | null, hasContent: boolean): boolean {
  return status === 'draft' && hasContent
}

export function statusNotice(
  status: string | null,
  options: { approveShown: boolean; manual: boolean },
): string | null {
  if (status === 'draft') return draftNotice(options)
  if (status === 'approved') return '已同意。同意不等于开始花钱。'
  if (status === 'rejected') return '已退回。这版先不采用。'
  if (status === 'superseded') return '已换新版。这版不再使用。'
  return null
}

export function goalLabel(intake: PrescriptionIntake | null): string {
  const goal = intake?.business_goal?.trim()
  return goal || UNREADABLE
}

export function periodLabel(phases: PrescriptionPhase[] | null | undefined): string {
  if (!phases?.length) return UNREADABLE
  if (phases.some((phase) => !Number.isFinite(phase.duration_weeks))) return UNREADABLE
  const weeks = phases.reduce((sum, phase) => sum + phase.duration_weeks, 0)
  return `大约 ${weeks} 周`
}

export function totalBudgetLabel(intake: PrescriptionIntake | null): string {
  const amount = intake?.monthly_budget_aud
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return UNREADABLE
  return formatAdMoney(amount, intake?.budget_currency)
}

/** Intake and content have no daily-budget field. Do not derive one from the prose. */
export function dailyBudgetLabel(): string {
  return UNREADABLE
}

export interface KeyNumber {
  label: string
  value: string
}

export function keyNumbers(kpis: KPITarget[] | null | undefined, limit = 5): KeyNumber[] {
  return (kpis ?? []).slice(0, limit).map((kpi) => ({
    label: splitMetricFormula(kpi.metric).label,
    value: keyNumberValue(kpi),
  }))
}

export function kpiChange(kpi: KPITarget): string {
  const now = kpi.current_value == null ? '还没有数' : formatCount(kpi.current_value)
  const unit = kpi.unit?.trim() ? ` ${kpi.unit.trim()}` : ''
  return `${now} → ${kpiTargetValue(kpi)}${unit}`
}

export function splitMetricFormula(metric: string): { label: string; formula: string | null } {
  const text = metric.trim()
  if (!text) return { label: UNREADABLE, formula: null }
  if (!FORMULA_HINT.test(text)) return { label: text, formula: null }
  const eq = text.indexOf('=')
  if (eq === -1) return splitCalcNote(text)
  return splitAtEquals(text, eq)
}

export function layoutParagraphs(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const cuts = sentenceCuts(trimmed)
  const chunks: string[] = []
  for (let i = 0; i < cuts.length; i++) {
    const end = i + 1 < cuts.length ? cuts[i + 1] : trimmed.length
    const piece = trimmed.slice(cuts[i], end).trim()
    if (piece) chunks.push(piece)
  }
  return chunks
}

export function proseBlocks(content: PrescriptionContent): string[] {
  const blocks = layoutParagraphs(content.summary ?? '')
  const narrative = content.narrative?.trim()
  if (narrative && narrative !== content.summary.trim()) blocks.push(...layoutParagraphs(narrative))
  return blocks
}

function draftNotice(options: { approveShown: boolean; manual: boolean }): string {
  const who = options.manual ? '草稿 · 人工写下的。' : '草稿。'
  const base = `${who}还没同意。`
  if (!options.approveShown) return base
  return `${base}点「同意」会把方案记到目标下面，按阶段排好。`
}

function kpiTargetValue(kpi: KPITarget): string {
  if (typeof kpi.target_value !== 'number' || !Number.isFinite(kpi.target_value)) return UNREADABLE
  return formatCount(kpi.target_value)
}

function keyNumberValue(kpi: KPITarget): string {
  const amount = kpiTargetValue(kpi)
  const unit = kpi.unit?.trim()
  if (amount === UNREADABLE || !unit) return amount
  return `${amount} ${unit}`
}

function formatCount(value: number): string {
  if (!Number.isInteger(value)) return String(value)
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function splitAtEquals(text: string, eq: number): { label: string; formula: string | null } {
  const head = text.slice(0, eq).trim()
  const tail = text.slice(eq).trim()
  const amount = head.match(/^(.*\S)\s*(\$[\d,]+(?:\.\d+)?)$/)
  if (!amount) return { label: head || UNREADABLE, formula: tail }
  return { label: amount[1].trim(), formula: `${amount[2]} ${tail}`.trim() }
}

function splitCalcNote(text: string): { label: string; formula: string | null } {
  const note = text.match(CALC_NOTE)
  if (!note || note.index == null) return { label: text, formula: null }
  const label = `${text.slice(0, note.index)}${text.slice(note.index + note[0].length)}`.trim()
  return { label: label || UNREADABLE, formula: note[0] }
}

function sentenceCuts(text: string): number[] {
  const cuts = new Set<number>([0])
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if ((char === '。' || char === '；') && i + 1 < text.length) cuts.add(i + 1)
  }
  MARKER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MARKER_RE.exec(text))) {
    if (match.index > 0) cuts.add(match.index)
  }
  return [...cuts].sort((a, b) => a - b)
}
