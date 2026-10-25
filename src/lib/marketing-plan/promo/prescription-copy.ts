/**
 * 把已存的处方收成推广计划页上的大白话。
 * 数字只来自处方里已经写下的字段；没写就空着，不估算、不补默认币种。
 * 第 7 天、第 14 天是产品复盘点：写下当天算第 1 天。这里没有客户事实。
 */

import { todayInNz } from './schedule-view'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const RULE_TITLE = /继续线|暂停线|保护期|加量条件|加量上限|马上停|立刻停|故障就停|三种故障|3\s*种故障|花费上限|每天上限|观察期|先别改|不要加预算|不要加量/
const RULE_MARKS = new Set(['rule', 'guardrail', '规矩'])
const TODO_MARKS = new Set(['todo', 'task', '动作'])
const DAY_MS = 86_400_000

export interface StoredSpend {
  daily: string | null
  total: string | null
  pacing: string | null
}

export interface SpendKpi {
  metric: string
  current_value: number | null
  target_value: number | null
  unit: string
}

export interface ReviewCopy {
  day7: string | null
  day14: string | null
  note: string
}

export function isStandingRule(title: string, mark: unknown): boolean {
  if (typeof mark === 'string') {
    if (RULE_MARKS.has(mark)) return true
    if (TODO_MARKS.has(mark)) return false
  }
  return RULE_TITLE.test(title)
}

/** 一条待办或一条规矩只留第一句。 */
export function oneSentence(title: string): string {
  const trimmed = title.replace(/\s+/g, ' ').trim()
  const first = trimmed.split(/(?<=[。！？!?])\s*/)[0]?.trim() ?? ''
  return first === '' ? trimmed : first
}

export function whySentences(narrative: string, summary: string): string[] {
  const source = narrative.trim() !== '' ? narrative : summary
  return firstSentences(source, 3)
}

export function ruleLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const lines: string[] = []
  for (const item of raw) lines.push(...linesFromRule(item))
  return lines
}

export function spendFromStored(
  content: Record<string, unknown> | null,
  kpis: readonly SpendKpi[],
  currency: string | null,
): StoredSpend {
  const stored = spendObject(content)
  const unit = spendCurrency(stored, currency)
  const fromObject = spendFromObject(stored, unit)
  const fromKpi = spendFromKpis(kpis, currency)
  return {
    daily: fromObject.daily ?? fromKpi.daily,
    total: fromObject.total ?? fromKpi.total,
    pacing: fromObject.pacing ?? fromKpi.pacing,
  }
}

/** 复盘起算日：正文里的 review_anchor / anchor_date，否则用写下时间的新西兰日期。 */
export function reviewAnchor(content: Record<string, unknown> | null, createdAt: unknown): string | null {
  for (const key of ['review_anchor', 'anchor_date']) {
    const value = content?.[key]
    if (typeof value === 'string' && DATE.test(value.trim())) return value.trim()
  }
  if (typeof createdAt !== 'string' || createdAt.trim() === '') return null
  const parsed = new Date(createdAt)
  if (Number.isNaN(parsed.getTime())) return null
  return todayInNz(parsed)
}

export function describeReview(anchor: string | null, today: string): ReviewCopy {
  const missing = { day7: null, day14: null, note: '还没写下从哪天起算，所以算不出还剩几天。' }
  if (!anchor || !DATE.test(anchor) || !DATE.test(today)) return missing
  const day7 = shiftDate(anchor, 6)
  const day14 = shiftDate(anchor, 13)
  if (!day7 || !day14) return missing
  return { day7: humanDate(day7, today), day14: humanDate(day14, today), note: reviewNote(today, day7, day14) }
}

function firstSentences(text: string, max: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized === '') return []
  const parts = normalized
    .split(/\n+|(?<=[。！？!?；;])\s*|(?<=\.)\s+/)
    .map(part => part.trim())
    .filter(part => part !== '')
  return parts.slice(0, max)
}

function linesFromRule(item: unknown): string[] {
  if (typeof item === 'string') {
    const line = oneSentence(item)
    return line === '' ? [] : [line]
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return []
  const row = item as Record<string, unknown>
  const text = typeof row.text === 'string' ? row.text : typeof row.title === 'string' ? row.title : ''
  const line = oneSentence(text)
  return line === '' ? [] : [line]
}

function spendObject(content: Record<string, unknown> | null): Record<string, unknown> | null {
  const raw = content?.spend
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

function spendCurrency(spend: Record<string, unknown> | null, fallback: string | null): string | null {
  const raw = typeof spend?.currency === 'string' ? spend.currency.trim() : ''
  return /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : fallback
}

function amountText(value: number, unit: string, currency: string | null): string {
  const num = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
  const suffix = unit.trim() !== '' ? unit.trim() : (currency ?? '')
  return suffix === '' ? num : `${num} ${suffix}`
}

function readLoose(value: unknown, currency: string | null): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return amountText(value, '', currency)
  return null
}

function readCents(value: unknown, currency: string | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return amountText(Math.round(value) / 100, '', currency)
}

function spendFromObject(spend: Record<string, unknown> | null, currency: string | null): StoredSpend {
  if (!spend) return { daily: null, total: null, pacing: null }
  return {
    daily: readLoose(spend.daily ?? spend.daily_amount, currency) ?? readCents(spend.daily_cents, currency),
    total: readLoose(spend.total ?? spend.total_amount, currency) ?? readCents(spend.total_cents, currency),
    pacing: readLoose(spend.pacing, currency) ?? readCents(spend.pacing_cents, currency),
  }
}

function spendBucket(metric: string): keyof StoredSpend | null {
  const name = metric.trim().toLowerCase()
  if (/配速|pacing/.test(name)) return 'pacing'
  if (/每天|每日|日预算|日花费|daily/.test(name)) return 'daily'
  if (/总共|合计|总预算|总花费|总额|total/.test(name)) return 'total'
  return null
}

function kpiText(kpi: SpendKpi, currency: string | null): string | null {
  const value = kpi.target_value ?? kpi.current_value
  if (value === null) return null
  return amountText(value, kpi.unit, currency)
}

function spendFromKpis(kpis: readonly SpendKpi[], currency: string | null): StoredSpend {
  const spend: StoredSpend = { daily: null, total: null, pacing: null }
  for (const kpi of kpis) {
    const bucket = spendBucket(kpi.metric)
    if (!bucket || spend[bucket]) continue
    spend[bucket] = kpiText(kpi, currency)
  }
  return spend
}

function shiftDate(iso: string, days: number): string | null {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function spanDays(from: string, to: string): number | null {
  if (!DATE.test(from) || !DATE.test(to)) return null
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / DAY_MS)
}

function humanDate(iso: string, today: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const sameYear = today.slice(0, 4) === String(year)
  const monthDay = `${month}月${day}日`
  return sameYear ? monthDay : `${year}年${monthDay}`
}

function reviewNote(today: string, day7: string, day14: string): string {
  const toDay7 = spanDays(today, day7)
  const toDay14 = spanDays(today, day14)
  if (toDay7 === null || toDay14 === null) return '还没写下从哪天起算，所以算不出还剩几天。'
  if (toDay7 > 0) return `距第 7 天还有 ${toDay7} 天`
  if (toDay7 === 0) return '第 7 天就是今天'
  if (toDay14 > 0) return `第 7 天已经过了，距第 14 天还有 ${toDay14} 天`
  if (toDay14 === 0) return '第 14 天就是今天'
  return '第 7 天和第 14 天都已经过了'
}
