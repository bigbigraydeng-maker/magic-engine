/**
 * Tuesday supervision turns an existing rule hit into one bounded amount.
 * Missing numbers block. Nothing here writes a budget or calls Meta.
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAdBudgetHeadroom } from '@/lib/capabilities/ads/envelope-facts'
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
import type {
  WeeklyBudgetBlock,
  WeeklyBudgetSuggestion,
  WeeklyCheckSummary,
} from './prescription-weekly-check'

const ACCOUNT_LABEL = '在投日预算'
const SCOPE_LABEL = '只改这一次日预算'
const STATE_LIMIT = 500
const LOOKBACK_DAYS = 14
const CURRENCY_WORD: Record<string, string> = { NZD: '纽元', AUD: '澳元', USD: '美元' }

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
}

export type BudgetIntent =
  | { kind: 'none' }
  | { kind: 'block'; reason: string }
  | { kind: 'need'; direction: 'increase' | 'decrease'; unitId: string }

export interface TuesdayBudgetIo {
  loadStates(clientIds: readonly string[]): Promise<SupervisionState[] | { error: string }>
  loadUnit(clientId: string, unitId: string, direction: 'increase' | 'decrease'): Promise<UnitRead | { error: string }>
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
  if (direction === 'increase' && !unit.headroomReadable) return { blocked: '账户和客户的剩余日预算读不到，这次不加。' }
  const before = unit.cents as number
  const remaining = unit.accountRemainingCents === null || unit.clientRemainingCents === null
    ? null : Math.min(unit.accountRemainingCents, unit.clientRemainingCents)
  const bounded = boundedAfter(direction, before, remaining)
  if ('blocked' in bounded) return bounded
  return { before, after: bounded.after, currency: currencyWord(unit.currency) as string }
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
  const built = await suggestionsFor(clientIds, loaded, io, now)
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

export async function attachTuesdayBudgetAmounts(
  supabase: SupabaseClient,
  summary: WeeklyCheckSummary,
  now: Date,
): Promise<WeeklyCheckSummary> {
  return fillTuesdayBudgets(summary, supabaseIo(supabase, now), now)
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
  return {
    kind: 'need',
    direction: cuts.length === 1 ? 'decrease' : 'increase',
    unitId: chosen[0],
  }
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
  return adsetIds(row.problems, 'D3').length > 0 || adsetIds(row.opportunities, 'O1').length > 0
    || hitWithoutAdset(row)
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

function boundedAfter(
  direction: 'increase' | 'decrease',
  before: number,
  remaining: number | null,
): { after: number } | { blocked: string } {
  if (direction === 'decrease') return boundedCut(before)
  if (!Number.isSafeInteger(remaining) || (remaining ?? -1) < 0) return { blocked: '账户或客户的剩余日预算算不出，这次不加。' }
  const raw = Math.round(before * (1 + MAX_BUDGET_ADJUSTMENT_RATIO))
  if (!Number.isSafeInteger(raw) || raw <= before) return { blocked: '按允许幅度算不出更高的日预算，这次不出卡。' }
  const available = before + (remaining as number)
  if (!Number.isSafeInteger(available)) return { blocked: '账户或客户的剩余日预算算不出，这次不加。' }
  const target = raw > available ? available : raw
  if (target <= before) return { blocked: '已经到日预算上限，这次不加。' }
  if (!checkBudgetWithinSafeRange(before, target).ok) return { blocked: '加幅超出一次允许的范围，这次不出卡。' }
  return { after: target }
}

function boundedCut(before: number): { after: number } | { blocked: string } {
  const cut = planCut(before)
  if (cut.newCents === null) return { blocked: '再减就会低于还能投的最低日预算，这次不出卡。' }
  if (cut.newCents >= before || !checkBudgetWithinSafeRange(before, cut.newCents).ok) {
    return { blocked: '减幅不在允许范围内，这次不出卡。' }
  }
  return { after: cut.newCents }
}

function currencyWord(code: string | null): string | null {
  if (!code) return null
  return CURRENCY_WORD[code.trim().toUpperCase()] ?? null
}

function centsText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

async function suggestionsFor(
  clientIds: readonly string[],
  states: readonly SupervisionState[],
  io: TuesdayBudgetIo,
  now: Date,
): Promise<{ suggestions: WeeklyBudgetSuggestion[]; blocks: WeeklyBudgetBlock[] }> {
  const suggestions: WeeklyBudgetSuggestion[] = []
  const blocks: WeeklyBudgetBlock[] = []
  for (const clientId of clientIds) {
    const placed = await placeClient(clientId, states.filter((row) => row.clientId === clientId), io, now)
    if (placed.suggestion) suggestions.push(placed.suggestion)
    if (placed.block) blocks.push(placed.block)
  }
  return { suggestions, blocks }
}

async function placeClient(
  clientId: string,
  states: readonly SupervisionState[],
  io: TuesdayBudgetIo,
  now: Date,
): Promise<{ suggestion?: WeeklyBudgetSuggestion; block?: WeeklyBudgetBlock }> {
  const intent = budgetIntent(states, now)
  if (intent.kind === 'none') return {}
  if (intent.kind === 'block') return { block: { clientId, reason: intent.reason } }
  const unit = await io.loadUnit(clientId, intent.unitId, intent.direction)
  if ('error' in unit) return { block: { clientId, reason: unit.error } }
  const judged = judgeUnit(unit, intent.direction, now)
  if ('blocked' in judged) return { block: { clientId, reason: judged.blocked } }
  return { suggestion: toSuggestion(clientId, intent.direction, intent.unitId, judged, now) }
}

function toSuggestion(
  clientId: string,
  direction: 'increase' | 'decrease',
  unitId: string,
  judged: { before: number; after: number; currency: string },
  now: Date,
): WeeklyBudgetSuggestion {
  const hex = createHash('sha256').update(`${direction}|${clientId}|${unitId}`).digest('hex').slice(0, 16)
  return {
    clientId,
    subjectKey: `wk${hex}`,
    direction,
    accountLabel: ACCOUNT_LABEL,
    beforeCents: judged.before,
    afterCents: judged.after,
    currencyLabel: judged.currency,
    why: direction === 'increase'
      ? '连续多天点击好于账户中位，预算却偏低，按现有幅度建议加一点。'
      : '巡检连续看到花钱没有对上结果，按现有幅度建议减一点。',
    dateLabel: tuesdayDateLabel(now),
    scopeLabel: SCOPE_LABEL,
  }
}

function tuesdayDateLabel(now: Date): string {
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    weekday: 'short',
  }).format(now)
  return `这${weekday}`
}

function checkedClients(summary: WeeklyCheckSummary): string[] {
  const ids: string[] = []
  for (const outcome of summary.outcomes) {
    if (outcome.result === 'checked' && !ids.includes(outcome.clientId)) ids.push(outcome.clientId)
  }
  return ids
}

function blockedSummary(
  summary: WeeklyCheckSummary,
  clientIds: readonly string[],
  reason: string,
): WeeklyCheckSummary {
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

function supabaseIo(supabase: SupabaseClient, now: Date): TuesdayBudgetIo {
  return {
    loadStates: (clientIds) => loadStates(supabase, clientIds, now),
    loadUnit: (clientId, unitId, direction) => loadUnit(supabase, clientId, unitId, direction, now),
  }
}

async function loadStates(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  now: Date,
): Promise<SupervisionState[] | { error: string }> {
  if (clientIds.length === 0) return []
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('ads_growth_states')
    .select('client_id, date, data_completeness, payload')
    .in('client_id', clientIds)
    .gte('date', since)
    .order('date', { ascending: false })
    .limit(STATE_LIMIT)
  if (error) return { error: '广告巡检读不到，这次不出加减预算的卡。' }
  const rows = data ?? []
  if (rows.length >= STATE_LIMIT) return { error: '巡检记录一次读不完，这次不出卡。' }
  return rows.map(mapState)
}

function mapState(row: {
  client_id: string
  date: string
  data_completeness: string | null
  payload: unknown
}): SupervisionState {
  const payload = row.payload && typeof row.payload === 'object'
    ? row.payload as { problems?: unknown; opportunities?: unknown }
    : {}
  const completeness = row.data_completeness === 'partial' || row.data_completeness === 'complete'
    ? row.data_completeness
    : null
  return {
    clientId: row.client_id,
    date: row.date,
    dataCompleteness: completeness,
    problems: asFindings(payload.problems),
    opportunities: asFindings(payload.opportunities),
  }
}

function asFindings(value: unknown): RuleFinding[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(asFinding)
}

function asFinding(value: unknown): RuleFinding[] {
  if (!value || typeof value !== 'object') return []
  const row = value as { code?: unknown; status?: unknown; units?: unknown }
  if (typeof row.code !== 'string' || typeof row.status !== 'string') return []
  const units = Array.isArray(row.units) ? row.units.flatMap(asUnit) : []
  return [{ code: row.code, status: row.status, title: '', units }]
}

function asUnit(value: unknown): NonNullable<RuleFinding['units']> {
  if (!value || typeof value !== 'object') return []
  const row = value as { level?: unknown; id?: unknown }
  if (typeof row.level !== 'string' || typeof row.id !== 'string' || !row.id) return []
  return [{ level: row.level, id: row.id, name: null }]
}

async function loadUnit(
  supabase: SupabaseClient,
  clientId: string,
  unitId: string,
  direction: 'increase' | 'decrease',
  now: Date,
): Promise<UnitRead | { error: string }> {
  const snap = await supabase
    .from('ad_entity_snapshots')
    .select('ad_account_id, daily_budget_minor, budget_level, effective_status, currency, captured_at')
    .eq('client_id', clientId)
    .eq('platform', 'meta')
    .eq('level', 'adset')
    .eq('entity_id', unitId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (snap.error) return { error: '日预算读不到，没有按 0 出卡。' }
  if (!snap.data) return { error: '现日预算读不到，没有按 0 出卡。' }
  const headroom = direction === 'increase' && snap.data.ad_account_id
    ? await readAdBudgetHeadroom(
      supabase, clientId, snap.data.ad_account_id, unitId,
      snap.data.daily_budget_minor ?? Number.NaN, now,
    )
    : null
  if (headroom && 'unavailable' in headroom) {
    return { error: '账户和客户总预算核算不完整，这次不加预算。' }
  }
  return {
    budgetLevel: snap.data.budget_level,
    cents: snap.data.daily_budget_minor,
    active: snap.data.effective_status === 'ACTIVE',
    currency: snap.data.currency,
    capturedAt: snap.data.captured_at,
    accountRemainingCents: headroom?.accountRemainingCents ?? null,
    clientRemainingCents: headroom?.clientRemainingCents ?? null,
    headroomReadable: headroom !== null && 'accountRemainingCents' in headroom,
  }
}
