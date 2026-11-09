/**
 * Decide whether today's NZ close-of-day forecast needs one confirm card.
 * This file does not write, does not call Meta, and does not treat a gap as zero.
 */
import { checkBudgetWithinSafeRange } from '@/lib/meta/guardrails'
import { amountLine, budgetWhat, money } from '@/lib/ads-budget-card/copy'
import { CAMPAIGN_PAUSE_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import type { CardFacts } from '@/lib/confirmation-card/facts'
import { pacingFromSamples, ticksFromSamples, type PacingPayload, type StoredSample } from './view'
import { accountDayKey } from './sample'
export const NZ_TZ = 'Pacific/Auckland'
/** Three sample intervals. Older than this is stale, not zero. */
export const SAMPLE_FRESH_MS = 30 * 60 * 1000
/** Same window as the circuit-breaker default. A missing stamp is not fresh. */
export const SNAPSHOT_FRESH_MS = 12 * 60 * 60 * 1000
export const OBSERVATION_WINDOW_DAYS = 7
export type CapGap =
  | 'no_plan'
  | 'no_cap'
  | 'many_plans'
  | 'unreadable'
  | 'no_samples'
  | 'stale_samples'
  | 'stale_snapshot'
  | 'snapshot_error'
  | 'no_snapshot'
  | 'no_live'
export interface LiveBudget { level: 'campaign' | 'adset'; id: string; campaignId: string | null; accountId: string; name: string; dailyMinor: number; active: boolean }
export interface SampleSignal { readable: boolean; latestAt: string | null; accountDay: string | null; spendMinor: number | null; forecastMinor: number | null }
export interface SnapshotSignal { readable: boolean; capturedAt: string | null; complete: boolean; error: string | null; budgets: readonly LiveBudget[] | null }
export interface CapFacts { now: Date; nzDay: string | null; planCount: number | null; capCents: number | null; sample: SampleSignal | null; snapshot: SnapshotSignal | null }
export interface CardPlan { kind: 'card'; action: 'decrease' | 'pause' | 'keep'; day: string; beforeMinor: number | null; afterMinor: number | null; name: string | null; accountId: string | null; campaignId: string | null; adsetId: string | null }
export type CapDecision = { kind: 'none' } | { kind: 'todo'; code: CapGap; day: string; summary: string } | CardPlan
export interface CapPorts { open(day: string): Promise<boolean>; issue(plan: CardPlan): Promise<boolean>; todo(code: CapGap, summary: string, day: string): Promise<boolean> }
export interface CapReceipt { cards: number; todos: number; action: string }
const SUMMARY: Record<CapGap, string> = {
  no_plan: '没有已批准的广告计划，没有出确认卡。',
  no_cap: '已批准的计划里没有每天上限，没有出确认卡。',
  many_plans: '已批准的广告计划不止一份，没有出确认卡。',
  unreadable: '计划、花费或快照读不出来，没有出确认卡。',
  no_samples: '今天的花费样本不够，没有把缺口当成零，也没有出确认卡。',
  stale_samples: '今天的花费样本已经过期，没有出确认卡。',
  stale_snapshot: '广告设置快照已经过期，没有出确认卡。',
  snapshot_error: '广告设置快照有错误，没有出确认卡。',
  no_snapshot: '没有一份完整的广告设置快照，没有出确认卡。',
  no_live: '花费已经高于每天上限，但没有还在投的广告系列，没有出确认卡。',
}
export function subjectFor(day: string): string {
  return `intraday-cap:${day}`
}
export function decreaseWithinStep(before: number, after: number): boolean {
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after)) return false
  if (after <= 0 || after >= before) return false
  return checkBudgetWithinSafeRange(before, after).ok
}
export function judgeIntradayCap(facts: CapFacts): CapDecision {
  const gap = gapOf(facts)
  if (gap) return todo(gap, facts.nzDay ?? 'unknown')
  return cardOf(facts)
}
export async function applyCapDecision(decision: CapDecision, ports: CapPorts): Promise<CapReceipt> {
  if (decision.kind === 'none') return { cards: 0, todos: 0, action: 'none' }
  if (decision.kind === 'todo') return todoReceipt(decision, ports)
  if (await ports.open(decision.day)) return { cards: 0, todos: 0, action: 'deduped' }
  const ok = await ports.issue(decision)
  return { cards: ok ? 1 : 0, todos: 0, action: ok ? decision.action : 'issue_failed' }
}
export function describePlan(plan: CardPlan, attach: boolean): CardFacts {
  return {
    subjectKey: subjectFor(plan.day),
    what: planWhat(plan, attach),
    account: '已登记的广告账户',
    amount: planAmount(plan),
    date: plan.day,
    scope: attach
      ? '不确认就保持现在这样。点了确认才会按这张卡改，现在没有改。'
      : '这张卡只是建议。确认了也不会改预算或暂停。',
    hardChecks: [{ label: '确认后才改', state: 'green', reason: '这一步没有改广告' }],
  }
}
const SYNTH_BUDGET: LiveBudget = {
  level: 'adset', id: '123456', campaignId: '234567', accountId: 'act_111111',
  name: '合成组', dailyMinor: 5000, active: true,
}
/** Fixture proposal. Writes nothing. A second pass must not open another card. */
export async function proposeDry(
  rows: readonly StoredSample[],
  capCents: number | null,
  now: Date,
): Promise<CapReceipt> {
  const decision = judgeIntradayCap(dryFacts(rows, capCents, now))
  const open = new Set<string>()
  const seen: CapReceipt[] = []
  const ports: CapPorts = {
    open: async (day) => open.has(day),
    issue: async (plan) => { open.add(plan.day); return true },
    todo: async () => true,
  }
  seen.push(await applyCapDecision(decision, ports))
  seen.push(await applyCapDecision(decision, ports))
  return {
    cards: seen[0]?.cards ?? 0,
    todos: seen[0]?.todos ?? 0,
    action: seen[1]?.action === 'deduped' ? seen[0]?.action ?? 'deduped' : seen[1]?.action ?? 'none',
  }
}
function dryFacts(rows: readonly StoredSample[], capCents: number | null, now: Date): CapFacts {
  const nzDay = accountDayKey(NZ_TZ, now)
  return {
    now,
    nzDay,
    planCount: capCents === null ? 0 : 1,
    capCents,
    sample: { readable: true, ...paceSignal(rows, now) },
    snapshot: {
      readable: true, capturedAt: now.toISOString(), complete: true, error: null, budgets: [SYNTH_BUDGET],
    },
  }
}
export function paceSignal(rows: readonly StoredSample[], now: Date): Omit<SampleSignal, 'readable'> {
  const nz = accountDayKey(NZ_TZ, now)
  const pacing = pacingFromSamples(rows, null, now)
  const ticks = ticksFromSamples(rows).filter((tick) => tick.accountDay === nz)
  return {
    latestAt: latestAt(rows, nz),
    accountDay: ticks[0]?.accountDay ?? pacing.accounts[0]?.accountDay ?? null,
    spendMinor: ticks.length === 0 ? null : sumLatest(ticks),
    forecastMinor: forecastMinor(pacing, nz),
  }
}
export function pickTarget(budgets: readonly LiveBudget[]): LiveBudget | null {
  const active = budgets.filter((row) => row.active && row.dailyMinor > 0)
  const campaignIds = new Set(active.filter((row) => row.level === 'campaign').map((row) => row.id))
  const pool = active.filter((row) => row.level === 'campaign' || !campaignIds.has(row.campaignId ?? ''))
  return [...pool].sort((a, b) => b.dailyMinor - a.dailyMinor)[0] ?? null
}
function gapOf(facts: CapFacts): CapGap | null {
  const plan = planGap(facts)
  if (plan) return plan
  return sampleGap(facts) ?? snapshotGap(facts)
}
function planGap(facts: CapFacts): CapGap | null {
  if (facts.planCount === null || !facts.nzDay) return 'unreadable'
  if (facts.planCount === 0) return 'no_plan'
  if (facts.planCount !== 1) return 'many_plans'
  if (facts.capCents === null || facts.capCents <= 0) return 'no_cap'
  return null
}
function sampleGap(facts: CapFacts): CapGap | null {
  const sample = facts.sample
  if (!sample?.readable) return 'unreadable'
  if (sample.spendMinor === null || sample.forecastMinor === null || !sample.latestAt) return 'no_samples'
  if (sample.accountDay !== facts.nzDay) return 'stale_samples'
  const age = ageMs(sample.latestAt, facts.now)
  if (age === null || age < 0 || age > SAMPLE_FRESH_MS) return 'stale_samples'
  return null
}
function snapshotGap(facts: CapFacts): CapGap | null {
  const snap = facts.snapshot
  if (!snap?.readable || snap.budgets === null) return 'unreadable'
  if (snap.error) return 'snapshot_error'
  if (!snap.complete || !snap.capturedAt) return 'no_snapshot'
  const age = ageMs(snap.capturedAt, facts.now)
  if (age === null || age < 0 || age > SNAPSHOT_FRESH_MS) return 'stale_snapshot'
  return null
}
function cardOf(facts: CapFacts): CapDecision {
  const cap = facts.capCents as number
  const sample = facts.sample as SampleSignal
  const day = facts.nzDay as string
  const forecast = wholeMinor(sample.forecastMinor)
  const spend = sample.spendMinor as number
  if (forecast === null) return todo('unreadable', day)
  if (forecast <= cap) return { kind: 'none' }
  const target = pickTarget(facts.snapshot?.budgets ?? [])
  if (spend > cap) return target && campaignOf(target) ? pausePlan(day, target) : todo('no_live', day)
  return decreaseOrKeep(day, target, forecast - cap)
}
function decreaseOrKeep(day: string, target: LiveBudget | null, excess: number): CapDecision {
  if (!target || excess <= 0) return keepPlan(day)
  const after = target.dailyMinor - excess
  if (!Number.isSafeInteger(after) || after <= 0 || after >= target.dailyMinor) return keepPlan(day)
  return {
    kind: 'card', action: 'decrease', day, beforeMinor: target.dailyMinor, afterMinor: after,
    name: target.name, accountId: target.accountId, campaignId: campaignOf(target),
    adsetId: target.level === 'adset' ? target.id : null,
  }
}
function pausePlan(day: string, target: LiveBudget): CardPlan {
  const campaignId = campaignOf(target)
  if (!campaignId) return keepPlan(day)
  return {
    kind: 'card', action: 'pause', day, beforeMinor: null, afterMinor: null,
    name: target.name, accountId: target.accountId, campaignId, adsetId: null,
  }
}
function keepPlan(day: string): CardPlan {
  return {
    kind: 'card', action: 'keep', day, beforeMinor: null, afterMinor: null,
    name: null, accountId: null, campaignId: null, adsetId: null,
  }
}
function wholeMinor(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null
  const rounded = Math.round(value)
  return Number.isSafeInteger(rounded) ? rounded : null
}
function campaignOf(row: LiveBudget): string | null {
  return row.level === 'campaign' ? row.id : row.campaignId
}
function todo(code: CapGap, day: string): CapDecision {
  return { kind: 'todo', code, day, summary: SUMMARY[code] }
}
async function todoReceipt(
  decision: Extract<CapDecision, { kind: 'todo' }>,
  ports: CapPorts,
): Promise<CapReceipt> {
  const wrote = await ports.todo(decision.code, decision.summary, decision.day)
  return { cards: 0, todos: wrote ? 1 : 0, action: decision.code }
}
function planWhat(plan: CardPlan, attach: boolean): string {
  if (plan.action === 'pause') {
    return attach
      ? CAMPAIGN_PAUSE_WHAT
      : '今天的花费已经高于每天上限。建议暂停在投的广告系列，不确认就保持现在这样。'
  }
  if (plan.action === 'decrease' && plan.beforeMinor !== null && plan.afterMinor !== null) {
    return attach
      ? budgetWhat(plan.name, plan.beforeMinor, plan.afterMinor)
      : `建议把日预算从 ${money(plan.beforeMinor)} 降到 ${money(plan.afterMinor)}。不确认就保持现在这样。`
  }
  return '收盘预测会高于每天上限。建议保持现在的日预算，不调高。'
}
function planAmount(plan: CardPlan): string {
  if (plan.action === 'decrease' && plan.beforeMinor !== null && plan.afterMinor !== null) {
    return amountLine(plan.beforeMinor, plan.afterMinor)
  }
  return plan.action === 'pause' ? '不改预算' : '保持现在的预算'
}
function ageMs(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  return now.getTime() - time
}
function latestAt(rows: readonly StoredSample[], nz: string | null): string | null {
  let best: string | null = null
  for (const row of rows) {
    if (row.accountDay !== nz) continue
    if (!best || row.sampledAt > best) best = row.sampledAt
  }
  return best
}
function sumLatest(ticks: ReturnType<typeof ticksFromSamples>): number {
  const latest = new Map<string, (typeof ticks)[number]>()
  for (const tick of ticks) {
    const prev = latest.get(tick.adAccountId)
    if (!prev || tick.localMinute >= prev.localMinute) latest.set(tick.adAccountId, tick)
  }
  let sum = 0
  for (const tick of latest.values()) sum += tick.spendMinor
  return sum
}
function forecastMinor(pacing: PacingPayload, nz: string | null): number | null {
  if (!nz || pacing.forecastMajor === null) return null
  const today = pacing.accounts.filter((row) => row.accountDay === nz)
  if (today.length === 0) return null
  const blocked = today.some((row) => (row.spendMajor ?? 0) > 0 && row.forecastStatus !== 'ok')
  const points = today.flatMap((row) => row.pointMinor === null ? [] : [row.pointMinor])
  if (blocked || points.length === 0) return null
  return points.reduce((sum, point) => sum + point, 0)
}
