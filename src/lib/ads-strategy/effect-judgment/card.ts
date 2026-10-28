/**
 * Effect-judgment card for one prescription (IMPACT Measure).
 * Pure: callers pass numbers they already read. Missing numbers stay empty.
 * The daily cap is recorded so later checks can compare it. Nothing here changes a budget.
 */

import { computeGoalPace, type GoalPaceVerdict } from '@/lib/ads-strategy/goal-pace'
import { withThinSampleGuard, withoutCapLens } from '@/lib/ads-strategy/portfolio/goal-context'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const CURRENCY = /^[A-Za-z]{3}$/
const COST_METRICS = new Set(['成本', 'cpl', 'cost'])
const VERDICTS = new Set<GoalPaceVerdict>(['on_track', 'behind', 'unreachable_within_caps', 'unknown'])

export interface MeasuredAmount {
  /** Major currency units, such as 12.5. Null when it could not be sourced. */
  amount: number | null
  currency: string | null
  source: string | null
  empty_reason: string | null
}

export interface MeasuredCents {
  cents: number | null
  currency: string | null
  source: string | null
  empty_reason: string | null
}

export interface EffectJudgmentCard {
  v: 1
  cost_per_result: MeasuredAmount
  daily_spend_cap: MeasuredCents
  pacing: {
    line: string | null
    verdict: GoalPaceVerdict | null
    empty_reason: string | null
  }
  review: {
    anchor: string | null
    day7: string | null
    day14: string | null
    empty_reason: string | null
  }
  blocked: boolean
  block_reasons: string[]
}

export interface CostReading {
  amount: number
  currency: string | null
}

export interface EffectGoal {
  periodStart: string
  periodEnd: string
  targetValue: number
  baselineValue: number
  budgetCurrency: string | null
}

export type ReadState = 'value' | 'missing' | 'unreadable'

export interface EffectJudgmentSources {
  goal: EffectGoal | null
  /** Approved cost from ad outcome settings. Not account history. */
  approvedCost: CostReading | null
  approvedCostState: ReadState
  /** Cost lines already written on the prescription. Used only to detect a clash. */
  prescriptionCosts: CostReading[]
  dailyCapCents: number | null
  dailyCapState: ReadState
  today: string
  actualToDate: number | null
  medianCostCents: number | null
  /** Null when the day count was not read. Never pass 0 to mean "unread". */
  sampleDays: number | null
  /** Set when the whole read failed. Every field stays empty. */
  loadError: string | null
}

export type CapGate = { action: 'keep' } | { action: 'block'; reason: string }

const UNREADABLE = '效果判断卡读不懂，不能拿别的数顶上。'

export function buildEffectJudgmentCard(input: EffectJudgmentSources): EffectJudgmentCard {
  if (input.loadError) return blockedCard(input.loadError)
  const currency = currencyCode(input.goal?.budgetCurrency ?? null)
  const cost = resolveCost(input, currency)
  const cap = resolveCap(input, currency)
  const pacing = resolvePacing(input)
  const review = resolveReview(input.goal?.periodStart ?? null)
  const block_reasons = [cost.empty_reason, cap.empty_reason, pacing.empty_reason, review.empty_reason]
    .filter((reason): reason is string => reason !== null)
  return {
    v: 1,
    cost_per_result: cost,
    daily_spend_cap: cap,
    pacing,
    review,
    blocked: block_reasons.length > 0,
    block_reasons,
  }
}

/** Undefined when this prescription was saved before the card existed. */
export function storedEffectCard(meta: unknown): EffectJudgmentCard | undefined {
  const record = asRecord(meta)
  if (!record || !Object.prototype.hasOwnProperty.call(record, 'measure')) return undefined
  return parseEffectJudgmentCard(record.measure) ?? blockedCard(UNREADABLE)
}

export function parseEffectJudgmentCard(value: unknown): EffectJudgmentCard | null {
  const row = asRecord(value)
  if (!row || row.v !== 1) return null
  const cost = parseAmount(row.cost_per_result)
  const cap = parseCents(row.daily_spend_cap)
  const pacing = parsePacing(row.pacing)
  const review = parseReview(row.review)
  if (!cost || !cap || !pacing || !review || typeof row.blocked !== 'boolean') return null
  if (!Array.isArray(row.block_reasons) || row.block_reasons.some(item => typeof item !== 'string')) return null
  return {
    v: 1,
    cost_per_result: cost,
    daily_spend_cap: cap,
    pacing,
    review,
    blocked: row.blocked,
    block_reasons: row.block_reasons as string[],
  }
}

export function effectJudgmentLines(card: EffectJudgmentCard | null | undefined): string[] {
  if (!card) return ['这份处方还没有效果判断卡。']
  const lines = [
    amountLine('每个结果最多花', card.cost_per_result),
    capLine(card.daily_spend_cap),
    textLine('配速', card.pacing.line, card.pacing.empty_reason),
    reviewLine(card.review),
  ]
  if (card.blocked) lines.push(`这张卡还不齐，缺的数补上之前不能拿别的数顶上。${card.block_reasons.join('')}`)
  return lines
}

/**
 * Plan seeding already reads a live daily cap to suggest a budget.
 * When the prescription has a card, that recorded cap is the one to check.
 * A clash or a blank cap blocks the suggestion. It does not rewrite the number.
 * No card (older prescriptions) leaves the suggestion alone.
 */
export function dailyCapGate(card: EffectJudgmentCard | null | undefined, liveCapCents: number | null): CapGate {
  if (card == null) return { action: 'keep' }
  const recorded = card.daily_spend_cap.cents
  if (recorded == null) {
    return { action: 'block', reason: card.daily_spend_cap.empty_reason ?? '效果判断卡没有写下每天花费上限。' }
  }
  if (liveCapCents == null) {
    return { action: 'block', reason: '现在读不到广告设置里的每天花费上限，不能只用处方上的数放行。' }
  }
  if (liveCapCents !== recorded) {
    return {
      action: 'block',
      reason: `每天花费上限对不上：处方记下 ${recorded} 分，现在的广告设置是 ${liveCapCents} 分，不取其中一个。`,
    }
  }
  return { action: 'keep' }
}

function blockedCard(reason: string): EffectJudgmentCard {
  const emptyAmount: MeasuredAmount = { amount: null, currency: null, source: null, empty_reason: reason }
  const emptyCents: MeasuredCents = { cents: null, currency: null, source: null, empty_reason: reason }
  return {
    v: 1,
    cost_per_result: emptyAmount,
    daily_spend_cap: emptyCents,
    pacing: { line: null, verdict: null, empty_reason: reason },
    review: { anchor: null, day7: null, day14: null, empty_reason: reason },
    blocked: true,
    block_reasons: [reason],
  }
}

function resolveCost(input: EffectJudgmentSources, currency: string | null): MeasuredAmount {
  if (input.approvedCostState === 'unreadable') {
    return blankAmount('广告结果设置读不出来，每个结果最多花多少先空着。')
  }
  const written = onePrescriptionCost(input.prescriptionCosts)
  if (written === 'clash') return blankAmount('处方里写了两个不一样的成本，对不上，不取其中一个。')
  if (input.approvedCostState === 'missing' || input.approvedCost == null) {
    return blankAmount(missingCostReason(written))
  }
  return agreedCost(input.approvedCost, written, currency)
}

function missingCostReason(written: CostReading | null): string {
  if (written) return '广告结果设置里没有每个结果的成本。处方正文里有一个数，但不能拿它当已批准的成本。'
  return '还没在广告结果设置里写下每个结果最多花多少，不能用历史花费代替。'
}

function agreedCost(approved: CostReading, written: CostReading | null, currency: string | null): MeasuredAmount {
  if (written && !sameMoney(approved.amount, written.amount)) {
    return blankAmount(`每个结果的成本对不上：广告结果设置是 ${moneyText(approved)}，处方正文是 ${moneyText(written)}，不取其中一个。`)
  }
  if (written && approved.currency && written.currency && approved.currency !== written.currency) {
    return blankAmount(`每个结果的成本币种对不上：广告结果设置是 ${approved.currency}，处方正文是 ${written.currency}，不取其中一个。`)
  }
  const known = approved.currency ?? written?.currency ?? currency
  const source = written ? '广告结果设置，和处方正文一致' : '广告结果设置'
  return {
    amount: roundMoney(approved.amount),
    currency: known,
    source: known === currency && currency && !approved.currency ? `${source}，币种来自目标` : source,
    empty_reason: null,
  }
}

function resolveCap(input: EffectJudgmentSources, currency: string | null): MeasuredCents {
  if (input.dailyCapState === 'unreadable') return blankCents('每天花费上限读不出来。')
  if (input.dailyCapState === 'missing' || input.dailyCapCents == null) {
    return blankCents('还没设置每天最多花多少。目标上的总预算不能拿来分成每天的上限。')
  }
  if (!Number.isInteger(input.dailyCapCents) || input.dailyCapCents <= 0) {
    return blankCents('每天花费上限不是整数分，不能用。')
  }
  return {
    cents: input.dailyCapCents,
    currency,
    source: currency ? '广告设置里的每天花费上限，币种来自目标' : '广告设置里的每天花费上限',
    empty_reason: null,
  }
}

function resolvePacing(input: EffectJudgmentSources): EffectJudgmentCard['pacing'] {
  const goal = input.goal
  if (!goal) return { line: null, verdict: null, empty_reason: '这份处方没有目标，算不出配速。' }
  if (!Number.isFinite(goal.targetValue) || !Number.isFinite(goal.baselineValue)) {
    return { line: null, verdict: null, empty_reason: '目标的起点或目标值读不到，算不出配速。' }
  }
  const pace = paceOf(input, goal)
  return { line: pace.reason, verdict: pace.verdict, empty_reason: null }
}

function paceOf(input: EffectJudgmentSources, goal: EffectGoal) {
  const computed = computeGoalPace({
    targetValue: goal.targetValue,
    baselineValue: goal.baselineValue,
    periodStart: goal.periodStart,
    periodEnd: goal.periodEnd,
    today: input.today,
    actualToDate: input.actualToDate,
    dailyCapCents: input.dailyCapState === 'value' ? input.dailyCapCents : null,
    medianCostPerResultCents7d: input.medianCostCents,
  })
  const capped = input.dailyCapState === 'value' ? computed : withoutCapLens(computed)
  return withThinSampleGuard(capped, input.medianCostCents, input.sampleDays)
}

function resolveReview(periodStart: string | null): EffectJudgmentCard['review'] {
  const anchor = periodStart?.trim() ?? ''
  const day7 = shiftDay(anchor, 6)
  const day14 = shiftDay(anchor, 13)
  if (!day7 || !day14) {
    return { anchor: null, day7: null, day14: null, empty_reason: '目标没有开始日，算不出第 7 天和第 14 天。' }
  }
  return { anchor, day7, day14, empty_reason: null }
}

function onePrescriptionCost(costs: CostReading[]): CostReading | null | 'clash' {
  if (costs.length === 0) return null
  const first = costs[0]
  for (const other of costs.slice(1)) {
    if (!sameMoney(first.amount, other.amount) || first.currency !== other.currency) return 'clash'
  }
  return first
}

function blankAmount(empty_reason: string): MeasuredAmount {
  return { amount: null, currency: null, source: null, empty_reason }
}

function blankCents(empty_reason: string): MeasuredCents {
  return { cents: null, currency: null, source: null, empty_reason }
}

function amountLine(label: string, money: MeasuredAmount): string {
  if (money.amount == null) return `${label}：还没写下。${money.empty_reason ?? ''}`
  const from = money.source ? `，来自${money.source}` : ''
  return `${label} ${moneyText({ amount: money.amount, currency: money.currency })}${from}。`
}

function capLine(money: MeasuredCents): string {
  if (money.cents == null) return `每天最多花：还没写下。${money.empty_reason ?? ''}`
  const major = money.cents / 100
  const from = money.source ? `，来自${money.source}` : ''
  return `每天最多花 ${moneyText({ amount: major, currency: money.currency })}${from}。这个数只用来对照，不会改广告预算。`
}

function textLine(label: string, line: string | null, empty: string | null): string {
  if (!line) return `${label}：还没写下。${empty ?? ''}`
  return `${label}：${line}`
}

function reviewLine(review: EffectJudgmentCard['review']): string {
  if (!review.day7 || !review.day14 || !review.anchor) {
    return `第 7 天和第 14 天：还没写下。${review.empty_reason ?? ''}`
  }
  return `第 7 天是${spokenDate(review.day7)}，第 14 天是${spokenDate(review.day14)}。从目标开始日${spokenDate(review.anchor)}起算，当天是第 1 天。`
}

function moneyText(money: CostReading): string {
  const num = Number.isInteger(money.amount) ? String(money.amount) : String(roundMoney(money.amount))
  return money.currency ? `${num} ${money.currency}` : `${num}（币种没写下）`
}

function spokenDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

function sameMoney(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100)
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100
}

function currencyCode(value: string | null): string | null {
  const raw = value?.trim() ?? ''
  return CURRENCY.test(raw) ? raw.toUpperCase() : null
}

function shiftDay(iso: string, days: number): string | null {
  if (!validDay(iso)) return null
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function validDay(iso: string): boolean {
  if (!DATE.test(iso)) return false
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function parseAmount(value: unknown): MeasuredAmount | null {
  const row = asRecord(value)
  if (!row) return null
  const amount = optionalNumber(row.amount)
  if (amount === 'bad') return null
  if (amount !== null && (!(amount > 0) || !Number.isFinite(amount))) return null
  return {
    amount,
    currency: optionalCurrency(row.currency),
    source: optionalText(row.source),
    empty_reason: optionalText(row.empty_reason),
  }
}

function parseCents(value: unknown): MeasuredCents | null {
  const row = asRecord(value)
  if (!row) return null
  const cents = optionalNumber(row.cents)
  if (cents === 'bad') return null
  if (cents !== null && (!Number.isInteger(cents) || cents <= 0)) return null
  return {
    cents,
    currency: optionalCurrency(row.currency),
    source: optionalText(row.source),
    empty_reason: optionalText(row.empty_reason),
  }
}

function parsePacing(value: unknown): EffectJudgmentCard['pacing'] | null {
  const row = asRecord(value)
  if (!row) return null
  const verdict = row.verdict
  if (verdict !== null && (typeof verdict !== 'string' || !VERDICTS.has(verdict as GoalPaceVerdict))) return null
  return {
    line: optionalText(row.line),
    verdict: verdict as GoalPaceVerdict | null,
    empty_reason: optionalText(row.empty_reason),
  }
}

function parseReview(value: unknown): EffectJudgmentCard['review'] | null {
  const row = asRecord(value)
  if (!row) return null
  const anchor = optionalDate(row.anchor)
  const day7 = optionalDate(row.day7)
  const day14 = optionalDate(row.day14)
  if (anchor === 'bad' || day7 === 'bad' || day14 === 'bad') return null
  return { anchor, day7, day14, empty_reason: optionalText(row.empty_reason) }
}

function optionalDate(value: unknown): string | null | 'bad' {
  if (value === null) return null
  if (typeof value !== 'string' || !validDay(value)) return 'bad'
  return value
}

function optionalNumber(value: unknown): number | null | 'bad' {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'bad'
  return value
}

function optionalCurrency(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? currencyCode(value) : null
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function prescriptionCostReadings(kpis: readonly { metric?: unknown; target_value?: unknown; unit?: unknown }[]): CostReading[] {
  const out: CostReading[] = []
  for (const kpi of kpis) {
    const metric = typeof kpi.metric === 'string' ? kpi.metric.trim().toLowerCase() : ''
    if (!COST_METRICS.has(metric)) continue
    if (typeof kpi.target_value !== 'number' || !Number.isFinite(kpi.target_value) || kpi.target_value <= 0) continue
    const unit = typeof kpi.unit === 'string' ? kpi.unit : null
    out.push({ amount: kpi.target_value, currency: currencyCode(unit) })
  }
  return out
}
