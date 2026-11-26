/**
 * Same-object, same-window comparison for one executed budget or pause card.
 *
 * Numbers come only from that ad set's own daily rows. Account totals are not
 * a substitute. The existing verdict function decides improved / worse; this
 * file only picks the rows, explains a refusal, and writes the sentence a
 * person can read.
 */

import type { OutcomeVerdict } from '../adapters/types'
import { getMetricPolarity } from '../polarity'
import type { PairMark, ReviewDirection } from './executed-review'
import {
  scoreReviewVerdict,
  verdictEnding,
  type ReviewVerdictRules,
  type ReviewVerdictTier,
} from './review-verdict-rules'

export const OBJECT_WINDOW_REASON = {
  overlap: '同一段时间里这个广告组还被改过，分不清是哪一次起的作用',
  missing: '这段时间没有这个广告组自己的数，不能拿整个账户的数来替',
  unreadable: '这个指标在这个广告组上算不出来',
  noise: '变化太小，看不出差别',
  conflict: '记下的方向和预期对不上',
} as const

const SUM_KEY: Readonly<Record<string, DayKey>> = {
  'ads.account.spend': 'spend',
  'ads.account.impressions': 'impressions',
  'ads.account.clicks': 'clicks',
  'ads.account.conversions': 'results',
}

const RATIO: Readonly<Record<string, readonly [DayKey, DayKey]>> = {
  'ads.account.cpc': ['spend', 'clicks'],
  'ads.account.ctr': ['clicks', 'impressions'],
  'ads.account.cpa': ['spend', 'results'],
  'ads.account.cost_per_lead': ['spend', 'leads'],
  'ads.account.cost_per_conversation': ['spend', 'messaging_conversations'],
}

const LABEL: Readonly<Record<string, string>> = {
  'ads.account.cpa': '获客成本',
  'ads.account.cost_per_lead': '每个留资的成本',
  'ads.account.cost_per_conversation': '每次开口的成本',
  'ads.account.spend': '花费',
  'ads.account.roas': '广告回报',
  'ads.account.ctr': '点击率',
  'ads.account.cpc': '每次点击的成本',
  'ads.account.clicks': '点击次数',
  'ads.account.impressions': '展示次数',
  'ads.account.conversions': '结果数',
}

type DayKey = 'spend' | 'impressions' | 'clicks' | 'leads' | 'messaging_conversations' | 'results'
type Half = { readonly kind: 'value'; readonly value: number } | { readonly kind: 'none' } | { readonly kind: 'unreadable' }
type Block = 'overlap' | 'conflict' | 'missing' | 'unreadable' | null

export interface ObjectDay {
  readonly insight_date: string
  readonly spend: number | null
  readonly impressions: number | null
  readonly clicks: number | null
  readonly leads: number | null
  readonly messaging_conversations: number | null
  readonly results: number | null
}

export type ReviewCaseVerdict = ReviewVerdictTier | 'improved' | 'worse' | 'unsure'

export interface ReviewCase {
  readonly verdict: ReviewCaseVerdict
  readonly reason: string | null
  readonly text: string
}

export interface ObjectJudgement {
  readonly storedVerdict: OutcomeVerdict
  readonly confidence: number
  readonly baseline: number | null
  readonly after: number | null
  readonly delta: number | null
  readonly deltaPct: number | null
  readonly case: ReviewCase
}

export interface VerdictFn {
  (metric: string, delta: number, deltaPct: number | null, expectedDelta: number | null): {
    readonly verdict: OutcomeVerdict
    readonly confidence: number
  }
}

export function objectWindowDates(executedAt: string, windowDays: number): { from: string; to: string; start: string } | null {
  const start = utcDay(executedAt)
  if (!start || !Number.isInteger(windowDays) || windowDays < 1) return null
  return { from: shiftDay(start, -windowDays), to: shiftDay(start, windowDays), start }
}

/** The sign already stored on the card. A pause has no up/down expectation. */
export function expectedForDirection(direction: ReviewDirection, column: number | null): number | null | 'conflict' {
  if (direction === 'pause') return column === null ? null : 'conflict'
  const sign = direction === 'up' ? 1 : -1
  if (column === null) return sign
  if (!Number.isFinite(column) || column === 0 || Math.sign(column) !== sign) return 'conflict'
  return column
}

export function judgeObjectWindow(input: {
  metric: string
  direction: ReviewDirection
  expectedDelta: number | null
  pair: PairMark
  rows: readonly ObjectDay[]
  executedAt: string
  windowDays: number
  beforeCents: unknown
  afterCents: unknown
  beforeStatus: unknown
  afterStatus: unknown
  basis: unknown
  verdictOf: VerdictFn
  reviewRules?: {
    readonly rules: ReviewVerdictRules
    readonly targetCost: number | null
    readonly primaryOutcomeCount: number
  }
}): ObjectJudgement {
  const measured = measure(input.metric, input.rows, input.executedAt, input.windowDays)
  const expected = expectedForDirection(input.direction, input.expectedDelta)
  const block = blockOf(input.pair, expected, measured)
  const reviewScored = !block && input.reviewRules
    ? scoreReviewVerdict({
      metric: input.metric,
      before: measured.before,
      after: measured.after,
      targetCost: input.reviewRules.targetCost,
      rules: input.reviewRules.rules,
      primaryOutcomeCount: input.reviewRules.primaryOutcomeCount,
    })
    : null
  const scored = !block && !reviewScored && expected !== 'conflict' && measured.delta !== null
    ? input.verdictOf(input.metric, measured.delta, measured.deltaPct, expected)
    : reviewScored
      ? { verdict: reviewScored.storedVerdict, confidence: reviewScored.confidence }
      : { verdict: 'inconclusive' as const, confidence: 0 }
  const spoken = block
    ? { verdict: 'unclear' as const, reason: OBJECT_WINDOW_REASON[block] }
    : reviewScored
      ? { verdict: reviewScored.tier, reason: reviewScored.reason }
      : speak(input.metric, scored)
  const endingTier: ReviewCaseVerdict = block ? 'unclear' : spoken.verdict
  return {
    storedVerdict: block ? 'inconclusive' : scored.verdict,
    confidence: block ? 0 : scored.confidence,
    baseline: measured.before,
    after: measured.after,
    delta: measured.delta,
    deltaPct: measured.deltaPct,
    case: {
      verdict: endingTier,
      reason: spoken.reason,
      text: paragraph(input, measured.before, measured.after, endingTier, spoken.reason),
    },
  }
}

function measure(metric: string, rows: readonly ObjectDay[], executedAt: string, windowDays: number) {
  const dates = objectWindowDates(executedAt, windowDays)
  const beforeHalf = dates ? halfValue(metric, between(rows, dates.from, dates.start)) : { kind: 'none' as const }
  const afterHalf = dates ? halfValue(metric, between(rows, dates.start, dates.to)) : { kind: 'none' as const }
  const before = beforeHalf.kind === 'value' ? beforeHalf.value : null
  const after = afterHalf.kind === 'value' ? afterHalf.value : null
  const gap = beforeHalf.kind === 'unreadable' || afterHalf.kind === 'unreadable' ? 'unreadable' as const : 'missing' as const
  return { before, after, gap, ...deltaOf(before, after) }
}

function blockOf(
  pair: PairMark,
  expected: number | null | 'conflict',
  measured: { before: number | null; after: number | null; gap: 'missing' | 'unreadable' },
): Block {
  if (pair === 'overlap') return 'overlap'
  if (expected === 'conflict') return 'conflict'
  if (measured.before !== null && measured.after !== null) return null
  return measured.gap
}

function speak(metric: string, scored: { verdict: OutcomeVerdict; confidence: number }): { verdict: ReviewCaseVerdict; reason: string | null } {
  if (scored.verdict === 'confirmed') return { verdict: 'improved', reason: null }
  if (scored.verdict === 'reversed') return { verdict: 'worse', reason: null }
  if (scored.confidence === 0) {
    const reason = getMetricPolarity(metric) === 'neutral'
      ? `${LABEL[metric] ?? '这项指标'}本身不分变好或变差`
      : OBJECT_WINDOW_REASON.unreadable
    return { verdict: 'unclear', reason }
  }
  return { verdict: 'unclear', reason: OBJECT_WINDOW_REASON.noise }
}

function paragraph(
  input: { metric: string; direction: ReviewDirection; windowDays: number; beforeCents: unknown; afterCents: unknown; beforeStatus: unknown; afterStatus: unknown; basis: unknown },
  before: number | null,
  after: number | null,
  verdict: ReviewCaseVerdict,
  reason: string | null,
): string {
  const name = LABEL[input.metric] ?? '这项指标'
  const done = actionSentence(input)
  const why = input.direction === 'pause' ? pauseWhy(input.basis) : `希望${name}${input.direction === 'down' ? '下降' : '上升'}。`
  const result = before !== null && after !== null
    ? `观察 ${input.windowDays} 天，这个广告组的${name}从 ${fmt(before)} 到 ${fmt(after)}。`
    : reason === OBJECT_WINDOW_REASON.unreadable
      ? `观察 ${input.windowDays} 天，这个广告组的${name}算不出来。`
      : `观察 ${input.windowDays} 天，这个广告组自己的${name}没有齐。`
  const ending = verdict === 'useful' || verdict === 'not_useful' || verdict === 'unclear'
    ? `${verdictEnding(verdict)}${reason ? reason : ''}`
    : verdict === 'improved'
      ? '结论：变好了。'
      : verdict === 'worse'
        ? '结论：变差了。'
        : `结论：判不了。${reason ?? ''}`
  return `${done}${why}${result}${ending}`
}

function actionSentence(input: { direction: ReviewDirection; beforeCents: unknown; afterCents: unknown; beforeStatus: unknown; afterStatus: unknown }): string {
  const before = cents(input.beforeCents)
  const after = cents(input.afterCents)
  if (before !== null && after !== null) return `把这个广告组的日预算从 ${money(before)} 调到 ${money(after)}。`
  const left = statusWord(input.beforeStatus)
  const right = statusWord(input.afterStatus)
  if (input.direction === 'pause' && left && right) return `把这个广告组从${left}改成${right}。`
  if (input.direction === 'pause') return '暂停了这个广告组。'
  return '改了这个广告组的日预算，改前改后的金额没有记下。'
}

function pauseWhy(basis: unknown): string {
  const text = typeof basis === 'string' ? basis.trim().replace(/[{}[\]`]/g, '').slice(0, 80) : ''
  return text.length > 0 ? `原因是：${text}。` : '处方要求暂停这一组。'
}

function halfValue(metric: string, rows: readonly ObjectDay[]): Half {
  if (rows.length === 0) return { kind: 'none' }
  const sumMetric = SUM_KEY[metric]
  if (sumMetric) {
    const value = sumOf(rows, sumMetric)
    return value === null ? { kind: 'unreadable' } : { kind: 'value', value }
  }
  const ratio = RATIO[metric]
  if (!ratio) return { kind: 'unreadable' }
  const top = sumOf(rows, ratio[0])
  const bottom = sumOf(rows, ratio[1])
  if (top === null || bottom === null || bottom === 0) return { kind: 'unreadable' }
  return { kind: 'value', value: top / bottom }
}

function between(rows: readonly ObjectDay[], from: string, to: string): ObjectDay[] {
  return rows.filter((row) => row.insight_date >= from && row.insight_date < to)
}

function sumOf(rows: readonly ObjectDay[], key: DayKey): number | null {
  let total = 0
  let seen = false
  for (const row of rows) {
    const value = row[key]
    if (value === null) continue
    total += value
    seen = true
  }
  return seen ? total : null
}

function deltaOf(before: number | null, after: number | null): { delta: number | null; deltaPct: number | null } {
  if (before === null || after === null) return { delta: null, deltaPct: null }
  const delta = after - before
  return { delta, deltaPct: before !== 0 ? (delta / Math.abs(before)) * 100 : null }
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function money(centsValue: number): string {
  return (centsValue / 100).toFixed(2)
}

function statusWord(value: unknown): string | null {
  if (value === 'ACTIVE') return '在投'
  if (value === 'PAUSED') return '已暂停'
  return null
}

function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

function utcDay(iso: string): string | null {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return new Date(time).toISOString().slice(0, 10)
}

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1))
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export function asObjectDay(row: unknown): ObjectDay | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const insight_date = typeof record.insight_date === 'string' ? record.insight_date.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(insight_date)) return null
  return {
    insight_date,
    spend: num(record.spend),
    impressions: num(record.impressions),
    clicks: num(record.clicks),
    leads: num(record.leads),
    messaging_conversations: num(record.messaging_conversations),
    results: num(record.results),
  }
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}
