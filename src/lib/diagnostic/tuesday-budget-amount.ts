/**
 * Tuesday supervision turns an existing rule hit into one bounded amount.
 * Missing numbers block. Nothing here writes a budget or calls Meta.
 */

import { createHash } from 'node:crypto'
import { checkBudgetWithinSafeRange, MAX_BUDGET_ADJUSTMENT_RATIO } from '@/lib/meta/guardrails'
import { planCut } from '@/lib/ads-strategy/stop-loss'
import { O1_MIN_DAYS } from '@/lib/ads-strategy/portfolio/opportunities/o1-hot-creative'
import { OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS } from '@/lib/ads-strategy/portfolio/diagnostics/thresholds'
import {
  ADS_RULE_MIN_STREAK,
  ADS_RULE_STALE_DAYS,
  ADS_RULE_STREAK_GAP_DAYS,
  dayGap,
  streakFor,
  type GrowthStateRow,
  type RuleFinding,
} from '@/lib/ads-strategy/rules/patrol-findings'
import type { StepRatio } from '@/lib/ads-budget-card/types'
import type {
  WeeklyBudgetBlock,
  WeeklyBudgetSuggestion,
  WeeklyCheckSummary,
} from './prescription-weekly-check'

const ACCOUNT_LABEL = '在投日预算'
const SCOPE_LABEL = '只改这一次日预算'
const ADSET_RE = /^\d{1,32}$/
const ACCOUNT_RE = /^act_\d{6,20}$/

export interface SupervisionState {
  clientId: string
  date: string
  dataCompleteness: 'complete' | 'partial' | null
  problems: RuleFinding[]
  opportunities: RuleFinding[]
}

export interface UnitRead {
  budgetLevel: string | null
  cents: number | null
  active: boolean
  currency: string | null
  capturedAt: string | null
  accountRemainingCents: number | null
  clientRemainingCents: number | null
  headroomReadable: boolean
  adAccountId: string | null
  name: string | null
  /** Missing means the platform default step. A word fails closed. */
  stepRatio?: StepRatio
}

export type BudgetIntent =
  | { kind: 'none' }
  | { kind: 'block'; reason: string }
  | { kind: 'need'; direction: 'increase' | 'decrease'; unitId: string }

export interface TuesdayBudgetIo {
  loadStates(clientIds: readonly string[]): Promise<SupervisionState[] | { error: string }>
  loadUnit(
    clientId: string,
    unitId: string,
    direction: 'increase' | 'decrease',
    prescriptionId: string,
  ): Promise<UnitRead | { error: string }>
}

export function budgetIntent(states: readonly SupervisionState[], now: Date): BudgetIntent {
  const rows = [...states].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const newest = rows[0]
  if (!newest) return { kind: 'none' }
  const fresh = freshness(newest, now)
  if (fresh !== 'ok') return staleOrPartial(newest, fresh)
  return intentFromHits(rows)
}

export function judgeUnit(
  unit: UnitRead,
  direction: 'increase' | 'decrease',
  now: Date,
): { before: number; after: number; currency: string } | { blocked: string } {
  const blocked = snapshotBlock(unit, now)
  if (blocked) return { blocked }
  const ratio = ratioOf(unit)
  if (typeof ratio !== 'number') return { blocked: ratio }
  if (direction === 'increase' && !unit.headroomReadable) return { blocked: '账户和客户的剩余日预算读不到，这次不加。' }
  const before = unit.cents as number
  const remaining = minRemaining(unit)
  const bounded = boundedBudgetAfter(direction, before, remaining, ratio)
  if ('blocked' in bounded) return bounded
  const currency = currencyWord(unit.currency)
  if (!currency) return { blocked: '币种读不到，这次不出卡。' }
  return { before, after: bounded.after, currency }
}

export function boundedBudgetAfter(
  direction: 'increase' | 'decrease',
  before: number,
  remaining: number | null,
  ratio: number,
): { after: number } | { blocked: string } {
  if (direction === 'decrease') return boundedCut(before, ratio)
  if (!Number.isSafeInteger(remaining) || (remaining ?? -1) < 0) {
    return { blocked: '账户或客户的剩余日预算算不出，这次不加。' }
  }
  const raw = Math.round(before * (1 + ratio))
  if (!Number.isSafeInteger(raw) || raw <= before) return { blocked: '按允许幅度算不出更高的日预算，这次不出卡。' }
  const available = before + (remaining as number)
  if (!Number.isSafeInteger(available)) return { blocked: '账户或客户的剩余日预算算不出，这次不加。' }
  const target = raw > available ? available : raw
  if (target <= before) return { blocked: '已经到日预算上限，这次不加。' }
  if (!checkBudgetWithinSafeRange(before, target, ratio).ok) return { blocked: '加幅超出一次允许的范围，这次不出卡。' }
  return { after: target }
}

export async function fillTuesdayBudgets(
  summary: WeeklyCheckSummary,
  io: TuesdayBudgetIo,
  now: Date,
): Promise<WeeklyCheckSummary> {
  const clientIds = checkedClients(summary)
  if (clientIds.length === 0) return summary
  const loaded = await io.loadStates(clientIds)
  if ('error' in loaded) return blockedSummary(summary, clientIds, loaded.error)
  const built = await suggestionsFor(summary, clientIds, loaded, io, now)
  return {
    ...summary,
    budgetSuggestions: built.suggestions,
    budgetBlocks: built.blocks,
    outcomes: withSentences(summary, built.suggestions, built.blocks),
  }
}

export function supervisionAmountSentence(row: WeeklyBudgetSuggestion): string {
  const way = row.direction === 'increase' ? '往上加' : '往下减'
  const from = centsText(row.beforeCents)
  const to = centsText(row.afterCents)
  const unit = row.currencyLabel ? ` ${row.currencyLabel}` : ''
  return `建议把每天的预算从 ${from}${unit} 改成 ${to}${unit}（${way}）。若确认卡成功出现在页面上，再到卡上确认。系统不会自动改。`
}

export function normalAdAccount(value: string | null): string | null {
  if (!value) return null
  const text = value.trim()
  if (ACCOUNT_RE.test(text)) return text
  if (/^\d{6,20}$/.test(text)) return `act_${text}`
  return null
}

export function numericAdset(value: string): boolean {
  return ADSET_RE.test(value)
}

function freshness(row: SupervisionState, now: Date): 'ok' | 'partial' | 'stale' {
  if (row.dataCompleteness === 'partial') return 'partial'
  const today = now.toISOString().slice(0, 10)
  return dayGap(row.date, today) > ADS_RULE_STALE_DAYS ? 'stale' : 'ok'
}

function staleOrPartial(row: SupervisionState, fresh: 'partial' | 'stale'): BudgetIntent {
  if (!hasMoneyHit(row)) return { kind: 'none' }
  const reason = fresh === 'partial'
    ? '广告巡检数据没拉全，这次不出加减预算的卡。'
    : '广告巡检太旧，这次不出加减预算的卡。'
  return { kind: 'block', reason }
}

function intentFromHits(rows: readonly SupervisionState[]): BudgetIntent {
  const newest = rows[0]
  if (!newest) return { kind: 'none' }
  if (hitWithoutAdset(newest)) return { kind: 'block', reason: '巡检没有说清是哪一组，这次不出卡。' }
  const cuts = qualified(rows, 'decrease')
  const raises = qualified(rows, 'increase')
  if (cuts.length > 0 && raises.length > 0) {
    return { kind: 'block', reason: '同一周既该加预算又该减预算，这次先不出卡。' }
  }
  const chosen = cuts.length > 0 ? cuts : raises
  if (chosen.length > 1) return { kind: 'block', reason: '有不止一处要调，这次先不出卡。' }
  if (chosen.length === 0) return { kind: 'none' }
  return { kind: 'need', direction: cuts.length === 1 ? 'decrease' : 'increase', unitId: chosen[0] }
}

function qualified(rows: readonly SupervisionState[], direction: 'increase' | 'decrease'): string[] {
  const newest = rows[0]
  if (!newest) return []
  if (direction === 'decrease') {
    return adsetIds(newest.problems, 'D3').filter((id) => (
      streakFor(`D3:${id}`, rows.map(toGrowth)) >= ADS_RULE_MIN_STREAK
    ))
  }
  return adsetIds(newest.opportunities, 'O1').filter((id) => o1Streak(id, rows) >= O1_MIN_DAYS)
}

function o1Streak(unitId: string, rows: readonly SupervisionState[]): number {
  let streak = 0
  let last: string | null = null
  for (const row of rows) {
    if (!adsetIds(row.opportunities, 'O1').includes(unitId)) break
    if (last !== null && dayGap(row.date, last) > ADS_RULE_STREAK_GAP_DAYS) break
    streak += 1
    last = row.date
  }
  return streak
}

function toGrowth(row: SupervisionState): GrowthStateRow {
  return {
    client_id: row.clientId,
    date: row.date,
    payload: { dataCompleteness: row.dataCompleteness ?? undefined, problems: row.problems },
  }
}

function hasMoneyHit(row: SupervisionState): boolean {
  return adsetIds(row.problems, 'D3').length > 0 || adsetIds(row.opportunities, 'O1').length > 0 || hitWithoutAdset(row)
}

function hitWithoutAdset(row: SupervisionState): boolean {
  return [...row.problems, ...row.opportunities].some((finding) => (
    (finding.code === 'D3' || finding.code === 'O1')
    && finding.status === 'hit'
    && adsetIds([finding], finding.code).length === 0
  ))
}

function adsetIds(findings: readonly RuleFinding[], code: string): string[] {
  const ids: string[] = []
  for (const finding of findings) {
    if (finding.code !== code || finding.status !== 'hit') continue
    for (const unit of finding.units ?? []) {
      if (unit.level === 'adset' && unit.id && !ids.includes(unit.id)) ids.push(unit.id)
    }
  }
  return ids
}

function snapshotBlock(unit: UnitRead, now: Date): string | null {
  if (!snapshotFresh(unit.capturedAt, now)) return '日预算快照太旧，这次不出卡。'
  if (!unit.active) return '这一组现在不是在投，这次不出卡。'
  if (unit.budgetLevel !== 'abo') return '预算不在这一组上，没法确认只改这一处，这次不出卡。'
  if (!Number.isSafeInteger(unit.cents) || (unit.cents ?? 0) <= 0) return '现日预算读不到，没有按 0 出卡。'
  if (!currencyWord(unit.currency)) return '币种读不到，这次不出卡。'
  return null
}

function snapshotFresh(capturedAt: string | null, now: Date): boolean {
  if (!capturedAt) return false
  const age = now.getTime() - Date.parse(capturedAt)
  const max = OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS * 60 * 60 * 1000
  return Number.isFinite(age) && age >= 0 && age <= max
}

function ratioOf(unit: UnitRead): number | string {
  const ratio = unit.stepRatio ?? MAX_BUDGET_ADJUSTMENT_RATIO
  if (ratio === 'unreadable') return '允许的调整幅度读不到，这次不出卡。'
  if (ratio === 'off') return '这个客户关掉了调整日预算的确认卡。'
  if (ratio === 'invalid') return '这个客户允许的调整幅度设置无效，这次不出卡。'
  return ratio
}

function minRemaining(unit: UnitRead): number | null {
  if (unit.accountRemainingCents === null || unit.clientRemainingCents === null) return null
  return Math.min(unit.accountRemainingCents, unit.clientRemainingCents)
}

function boundedCut(before: number, ratio: number): { after: number } | { blocked: string } {
  const cut = planCut(before, ratio)
  if (cut.newCents === null) return { blocked: '再减就会低于还能投的最低日预算，这次不出卡。' }
  if (cut.newCents >= before || !checkBudgetWithinSafeRange(before, cut.newCents, ratio).ok) {
    return { blocked: '减幅不在允许范围内，这次不出卡。' }
  }
  return { after: cut.newCents }
}

function currencyWord(code: string | null): string | null {
  if (!code) return null
  const word: Record<string, string> = { NZD: '纽元', AUD: '澳元', USD: '美元' }
  return word[code.trim().toUpperCase()] ?? null
}

function centsText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

async function suggestionsFor(
  summary: WeeklyCheckSummary,
  clientIds: readonly string[],
  states: readonly SupervisionState[],
  io: TuesdayBudgetIo,
  now: Date,
): Promise<{ suggestions: WeeklyBudgetSuggestion[]; blocks: WeeklyBudgetBlock[] }> {
  const suggestions: WeeklyBudgetSuggestion[] = []
  const blocks: WeeklyBudgetBlock[] = []
  for (const clientId of clientIds) {
    const placed = await placeClient(summary, clientId, states.filter((row) => row.clientId === clientId), io, now)
    if (placed.suggestion) suggestions.push(placed.suggestion)
    if (placed.block) blocks.push(placed.block)
  }
  return { suggestions, blocks }
}

async function placeClient(
  summary: WeeklyCheckSummary,
  clientId: string,
  states: readonly SupervisionState[],
  io: TuesdayBudgetIo,
  now: Date,
): Promise<{ suggestion?: WeeklyBudgetSuggestion; block?: WeeklyBudgetBlock }> {
  const intent = budgetIntent(states, now)
  if (intent.kind === 'none') return {}
  if (intent.kind === 'block') return { block: { clientId, reason: intent.reason } }
  const prescriptionId = onePrescription(summary, clientId)
  if (!prescriptionId) return { block: { clientId, reason: '没有恰好一份正在执行的方案，这次不出卡。' } }
  const unit = await io.loadUnit(clientId, intent.unitId, intent.direction, prescriptionId)
  if ('error' in unit) return { block: { clientId, reason: unit.error } }
  const judged = judgeUnit(unit, intent.direction, now)
  if ('blocked' in judged) return { block: { clientId, reason: judged.blocked } }
  const accountId = normalAdAccount(unit.adAccountId)
  if (!accountId) return { block: { clientId, reason: '广告账户对不上这位客户，这次不出卡。' } }
  return { suggestion: toSuggestion(clientId, intent, accountId, prescriptionId, unit.name, judged, now) }
}

function onePrescription(summary: WeeklyCheckSummary, clientId: string): string | null {
  const ids: string[] = []
  for (const outcome of summary.outcomes) {
    if (outcome.result !== 'checked' || outcome.clientId !== clientId || !outcome.prescriptionId) continue
    if (!ids.includes(outcome.prescriptionId)) ids.push(outcome.prescriptionId)
  }
  return ids.length === 1 ? ids[0] : null
}

function toSuggestion(
  clientId: string,
  intent: { direction: 'increase' | 'decrease'; unitId: string },
  accountId: string,
  prescriptionId: string,
  name: string | null,
  judged: { before: number; after: number; currency: string },
  now: Date,
): WeeklyBudgetSuggestion {
  const hex = createHash('sha256').update(`${intent.direction}|${clientId}|${intent.unitId}`).digest('hex').slice(0, 16)
  return {
    clientId,
    subjectKey: `wk${hex}`,
    direction: intent.direction,
    accountLabel: ACCOUNT_LABEL,
    beforeCents: judged.before,
    afterCents: judged.after,
    currencyLabel: judged.currency,
    why: intent.direction === 'increase'
      ? '连续多天点击好于账户中位，预算却偏低，按现有幅度建议加一点。'
      : '巡检连续看到花钱没有对上结果，按现有幅度建议减一点。',
    dateLabel: tuesdayDateLabel(now),
    scopeLabel: SCOPE_LABEL,
    adsetId: intent.unitId,
    adAccountId: accountId,
    prescriptionId,
    name: shortName(name),
  }
}

function shortName(name: string | null): string | null {
  if (!name) return null
  const text = name.trim()
  if (!text || text.length > 40 || /[{}[\]`]/.test(text) || /\d{10,}/.test(text) || /act_/i.test(text)) return null
  return text
}

function tuesdayDateLabel(now: Date): string {
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', weekday: 'short' }).format(now)
  return `这${weekday}`
}

function checkedClients(summary: WeeklyCheckSummary): string[] {
  const ids: string[] = []
  for (const outcome of summary.outcomes) {
    if (outcome.result === 'checked' && !ids.includes(outcome.clientId)) ids.push(outcome.clientId)
  }
  return ids
}

function blockedSummary(summary: WeeklyCheckSummary, clientIds: readonly string[], reason: string): WeeklyCheckSummary {
  const budgetBlocks = clientIds.map((clientId) => ({ clientId, reason }))
  return { ...summary, budgetBlocks, outcomes: withSentences(summary, [], budgetBlocks) }
}

function withSentences(
  summary: WeeklyCheckSummary,
  suggestions: readonly WeeklyBudgetSuggestion[],
  blocks: readonly WeeklyBudgetBlock[],
): WeeklyCheckSummary['outcomes'] {
  const said = new Set<string>()
  return summary.outcomes.map((outcome) => appendOnce(outcome, suggestions, blocks, said))
}

function appendOnce(
  outcome: WeeklyCheckSummary['outcomes'][number],
  suggestions: readonly WeeklyBudgetSuggestion[],
  blocks: readonly WeeklyBudgetBlock[],
  said: Set<string>,
): WeeklyCheckSummary['outcomes'][number] {
  if (outcome.result !== 'checked' || said.has(outcome.clientId)) return outcome
  const suggestion = suggestions.find((row) => row.clientId === outcome.clientId)
  const block = blocks.find((row) => row.clientId === outcome.clientId)
  const extra = suggestion ? supervisionAmountSentence(suggestion) : block?.reason
  if (!extra) return outcome
  said.add(outcome.clientId)
  return { ...outcome, suggestion: `${outcome.suggestion ?? ''}${extra}` }
}
