/**
 * Exclusive claim of one goal's budget segment and one sale's effect.
 *
 * Stage: magic-engine-platform app/impact Prescribe.
 * Pure judgment. Does not approve, write, orchestrate, or move money.
 *
 * An approved holder occupies a budget segment when its dates overlap the
 * candidate and the money is positive or unknown. Unknown is not zero.
 * Explicit zero and a segment with no budget field do not occupy money.
 * The same sale id cannot be credited to two prescriptions. Sale identity
 * is an opaque id (the sale row id). This file does not equate a human
 * order reference with that id, and it does not apply any client's
 * deposit / seat rules.
 *
 * Paused days inside a promo phase stay inside that phase's window.
 * Amounts are never added across claims and never converted between currencies.
 *
 * Later integration (not this PR — do not call this from approve routes yet):
 * 1. Marketing plan approval, before dispatch:
 *    src/app/api/clients/[id]/marketing-plan/[planId]/approve/route.ts
 *    The follow-up also edits src/lib/marketing-plan/plan-guard.ts, so it
 *    must not land beside an in-flight edit of that file.
 * 2. Diagnostic approval, before landing, when status becomes approved:
 *    src/app/api/clients/[id]/prescription/[pId]/route.ts
 *    Prescription has no dates; pass GoalRow.period_start / period_end.
 * 3. Ads daily prescription:
 *    src/lib/ads-strategy/evaluate.ts (CampaignNarrative.prescription,
 *    date = NarrativePayload.generated_for) and the growth-state write in
 *    src/lib/ads-strategy/agents/patrol.ts (buildGrowthState).
 *    The daily Prescription type has no budget field. Do not add one here.
 * 4. Sale effect: before crediting a me_sale_outcomes.id to a prescription.
 *    No such call site exists yet.
 */

import type { CampaignNarrative } from '@/lib/ads-strategy/evaluate'
import type { GoalRow } from '@/types/strategy'
import type { BudgetAllocationItem, Prescription as DiagnosticPrescription, PrescriptionContent } from '@/types/diagnostic'
import type { MarketingPlan } from '../types'
import { readPromoSpec, type PromoPhase } from './spec'

export const PRESCRIPTION_SOURCES = [
  'diagnostic_prescription',
  'marketing_plan',
  'ads_daily',
] as const

export type PrescriptionSource = (typeof PRESCRIPTION_SOURCES)[number]

export interface DateWindow {
  /** Inclusive civil date YYYY-MM-DD. null = unknown, never coerced to a zero-length range. */
  start_date: string | null
  end_date: string | null
}

export type BudgetHold =
  | { kind: 'none'; evidence: string }
  | { kind: 'unknown'; evidence: string }
  | { kind: 'amount'; amount_cents: number | null; currency: string | null; evidence: string }

export interface BudgetSegmentClaim {
  segment_key: string
  window: DateWindow
  budget: BudgetHold
}

export interface ExclusiveClaim {
  source: PrescriptionSource
  id: string
  /** null = the source type did not say which goal. Not the same as "a different goal". */
  goal_id: string | null
  /**
   * Holders block only when this is true.
   * The candidate is judged either way: a draft can be refused before approval.
   * Ads daily Prescription has no approval status, so the reader leaves this false.
   */
  approved: boolean
  segments: BudgetSegmentClaim[]
  /** Opaque sale row ids already credited, or the ones this candidate wants to credit. */
  sale_ids: readonly string[]
}

export interface ClaimRef {
  source: PrescriptionSource
  id: string
  segment_key: string | null
}

export type ExclusiveConflictKind = 'budget_overlap' | 'outcome_double_count' | 'unknown_facts'

export interface ExclusiveClaimConflict {
  kind: ExclusiveConflictKind
  reason: string
  goal_id: string | null
  holder: ClaimRef | null
  candidate: ClaimRef
  overlap: { start_date: string; end_date: string } | null
  sale_id: string | null
}

export interface ExclusiveClaimResult {
  allowed: boolean
  conflicts: ExclusiveClaimConflict[]
}

export type MarketingPlanClaimInput = Pick<
  MarketingPlan,
  'id' | 'status' | 'start_date' | 'end_date'
> & { plan_data: unknown }

export type DiagnosticClaimInput = Pick<DiagnosticPrescription, 'id' | 'status' | 'goal_id' | 'content'>

export interface AdsDailyClaimInput {
  card: Pick<CampaignNarrative, 'campaign_id' | 'prescription'>
  /** NarrativePayload.generated_for, or ads_growth_states.date. Not on Prescription. */
  date: string | null
  goal_id: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type GoalRelation = 'same' | 'different' | 'unknown'

interface ClosedWindow {
  start: string
  end: string
}

/** Positive money occupies. Unknown occupies. Explicit zero and kind 'none' do not. */
export function budgetOccupies(budget: BudgetHold): boolean {
  if (budget.kind === 'none') return false
  if (budget.kind === 'unknown') return true
  if (budget.amount_cents === null || budget.amount_cents < 0) return true
  return budget.amount_cents > 0
}

export function judgeExclusiveClaim(
  existing: readonly ExclusiveClaim[],
  candidate: ExclusiveClaim,
): ExclusiveClaimResult {
  const conflicts: ExclusiveClaimConflict[] = []
  for (const holder of existing) {
    if (!holder.approved || isSameClaim(holder, candidate)) continue
    pushBudgetConflicts(holder, candidate, conflicts)
    pushSaleConflicts(holder, candidate, conflicts)
  }
  pushBlankSaleConflict(candidate, conflicts)
  return { allowed: conflicts.length === 0, conflicts }
}

export function claimFromDiagnosticPrescription(
  prescription: DiagnosticClaimInput,
  goalPeriod: Pick<GoalRow, 'period_start' | 'period_end'> | null,
): ExclusiveClaim {
  const window = goalPeriod
    ? { start_date: goalPeriod.period_start, end_date: goalPeriod.period_end }
    : { start_date: null, end_date: null }
  return {
    source: 'diagnostic_prescription',
    id: prescription.id,
    goal_id: prescription.goal_id,
    approved: prescription.status === 'approved',
    sale_ids: [],
    segments: [{ segment_key: 'budget_allocation', window, budget: diagnosticBudget(prescription.content) }],
  }
}

export function claimFromMarketingPlan(plan: MarketingPlanClaimInput): ExclusiveClaim {
  const approved = plan.status === 'approved'
  const promo = readPromoSpec(plan.plan_data)
  if (!promo) {
    return {
      source: 'marketing_plan',
      id: plan.id,
      goal_id: null,
      approved,
      sale_ids: [],
      segments: [unknownPlanSegment(plan)],
    }
  }
  return {
    source: 'marketing_plan',
    id: plan.id,
    goal_id: promo.goal_id,
    approved,
    sale_ids: [],
    segments: promo.phases.map(phaseSegment),
  }
}

export function claimFromAdsDaily(input: AdsDailyClaimInput): ExclusiveClaim {
  const id = input.date ? `${input.card.campaign_id}@${input.date}` : input.card.campaign_id
  const base = {
    source: 'ads_daily' as const,
    id,
    goal_id: input.goal_id,
    approved: false,
    sale_ids: [] as string[],
  }
  if (!input.card.prescription) return { ...base, segments: [] }
  return {
    ...base,
    segments: [{
      segment_key: 'day',
      window: { start_date: input.date, end_date: input.date },
      budget: {
        kind: 'none',
        evidence: '广告日处方类型没有预算字段，不把缺失当成 0，也不当成占了预算',
      },
    }],
  }
}

function unknownPlanSegment(plan: MarketingPlanClaimInput): BudgetSegmentClaim {
  return {
    segment_key: 'plan_window',
    window: { start_date: plan.start_date, end_date: plan.end_date },
    budget: {
      kind: 'unknown',
      evidence: '推广计划没有可读的推广结构预算，缺失记为未知，不是 0',
    },
  }
}

function phaseSegment(phase: PromoPhase): BudgetSegmentClaim {
  return {
    segment_key: `phase:${phase.id}`,
    window: { start_date: phase.start_date, end_date: phase.end_date },
    budget: phaseBudget(phase),
  }
}

function phaseBudget(phase: PromoPhase): BudgetHold {
  let cents = 0
  let ads = 0
  for (const step of phase.steps) {
    if (step.kind !== 'ads_campaign') continue
    ads += 1
    const daily = step.settings.daily_budget_cents
    if (typeof daily !== 'number' || !Number.isFinite(daily) || daily < 0) {
      return {
        kind: 'amount',
        amount_cents: null,
        currency: null,
        evidence: '推广计划广告步骤的日预算读不到，记为未知，不是 0；步骤上没有币种，不做换算',
      }
    }
    cents += daily
  }
  if (ads === 0) return { kind: 'none', evidence: '这个阶段没有广告步骤，不占预算' }
  return {
    kind: 'amount',
    amount_cents: cents,
    currency: null,
    evidence: '这个阶段广告步骤的日预算（分）相加；步骤上没有币种，不做换算。暂停日仍算在阶段日期里',
  }
}

function diagnosticBudget(content: PrescriptionContent | null): BudgetHold {
  if (!content) return { kind: 'unknown', evidence: '诊断处方没有正文，预算记为未知，不是 0' }
  const fromAllocation = allocationHold(content.budget_allocation)
  if (fromAllocation) return fromAllocation
  if (hasPositiveBudgetPercent(content)) {
    return {
      kind: 'unknown',
      evidence: '诊断处方只写了预算占比，没有金额，记为未知，不是 0',
    }
  }
  return { kind: 'unknown', evidence: '诊断处方的预算明细是空的，缺失记为未知，不是 0' }
}

function allocationHold(items: BudgetAllocationItem[] | undefined): BudgetHold | null {
  if (!Array.isArray(items) || items.length === 0) return null
  let cents = 0
  for (const item of items) {
    const aud = item?.amount_aud
    if (typeof aud !== 'number' || !Number.isFinite(aud) || aud < 0) {
      return {
        kind: 'amount',
        amount_cents: null,
        currency: 'AUD',
        evidence: '诊断处方预算金额不是非负数字，记为未知，不是 0',
      }
    }
    cents += Math.round(aud * 100)
  }
  return {
    kind: 'amount',
    amount_cents: cents,
    currency: 'AUD',
    evidence: '诊断处方预算明细的澳元金额合计后换成分',
  }
}

function hasPositiveBudgetPercent(content: PrescriptionContent): boolean {
  if (!Array.isArray(content.phases)) return false
  return content.phases.some(phase => {
    const pct = phase.initiative_seed?.budget_percent
    return typeof pct === 'number' && Number.isFinite(pct) && pct > 0
  })
}

function pushBudgetConflicts(
  holder: ExclusiveClaim,
  candidate: ExclusiveClaim,
  into: ExclusiveClaimConflict[],
): void {
  const goal = goalRelation(holder.goal_id, candidate.goal_id)
  if (goal === 'different') return
  for (const left of holder.segments) {
    if (!budgetOccupies(left.budget)) continue
    for (const right of candidate.segments) {
      if (!budgetOccupies(right.budget)) continue
      const conflict = budgetConflict(holder, candidate, left, right, goal)
      if (conflict) into.push(conflict)
    }
  }
}

function budgetConflict(
  holder: ExclusiveClaim,
  candidate: ExclusiveClaim,
  left: BudgetSegmentClaim,
  right: BudgetSegmentClaim,
  goal: GoalRelation,
): ExclusiveClaimConflict | null {
  const holderWindow = validWindow(left.window)
  const candidateWindow = validWindow(right.window)
  const holderRef = refOf(holder, left.segment_key)
  const candidateRef = refOf(candidate, right.segment_key)
  if (!holderWindow || !candidateWindow) {
    return unknownWindowConflict(holder, candidate, holderRef, candidateRef, goal)
  }
  const overlap = intersect(holderWindow, candidateWindow)
  if (!overlap) return null
  const moneyNote = moneyUnknown(left.budget) || moneyUnknown(right.budget)
    ? '其中一份预算金额未知，没有按 0 处理。'
    : ''
  if (goal === 'unknown') {
    return makeConflict({
      kind: 'unknown_facts',
      reason: `目标编号未知，不能确认 ${pairText(holder, candidate)} 是不是同一目标；日期重叠（${overlap.start} 至 ${overlap.end}）时不能再占预算。${moneyNote}`,
      goal_id: null,
      holder: holderRef,
      candidate: candidateRef,
      overlap: { start_date: overlap.start, end_date: overlap.end },
      sale_id: null,
    })
  }
  return makeConflict({
    kind: 'budget_overlap',
    reason: `同一目标 ${candidate.goal_id} 上，${pairText(holder, candidate)} 的日期重叠（${overlap.start} 至 ${overlap.end}），后一份不能再占这段预算。${moneyNote}`,
    goal_id: candidate.goal_id,
    holder: holderRef,
    candidate: candidateRef,
    overlap: { start_date: overlap.start, end_date: overlap.end },
    sale_id: null,
  })
}

function unknownWindowConflict(
  holder: ExclusiveClaim,
  candidate: ExclusiveClaim,
  holderRef: ClaimRef,
  candidateRef: ClaimRef,
  goal: GoalRelation,
): ExclusiveClaimConflict {
  const reason = goal === 'unknown'
    ? `日期和目标编号都未知，不能确认 ${pairText(holder, candidate)} 的预算段是否错开，不能认领。`
    : `日期未知，不能确认 ${pairText(holder, candidate)} 的预算段是否错开，不能认领。`
  return makeConflict({
    kind: 'unknown_facts',
    reason,
    goal_id: goal === 'same' ? knownGoal(candidate.goal_id) : null,
    holder: holderRef,
    candidate: candidateRef,
    overlap: null,
    sale_id: null,
  })
}

function pushSaleConflicts(
  holder: ExclusiveClaim,
  candidate: ExclusiveClaim,
  into: ExclusiveClaimConflict[],
): void {
  const held = new Set<string>()
  for (const raw of holder.sale_ids) {
    const id = cleanSaleId(raw)
    if (id) held.add(id)
  }
  const seen = new Set<string>()
  for (const raw of candidate.sale_ids) {
    const id = cleanSaleId(raw)
    if (!id || seen.has(id) || !held.has(id)) continue
    seen.add(id)
    into.push(makeConflict({
      kind: 'outcome_double_count',
      reason: `成交 ${id} 已经计入${sourceLabel(holder.source)} ${holder.id}，不能再计入${sourceLabel(candidate.source)} ${candidate.id}。`,
      goal_id: knownGoal(candidate.goal_id),
      holder: refOf(holder, null),
      candidate: refOf(candidate, null),
      overlap: null,
      sale_id: id,
    }))
  }
}

function pushBlankSaleConflict(candidate: ExclusiveClaim, into: ExclusiveClaimConflict[]): void {
  const blank = candidate.sale_ids.some(id => cleanSaleId(id) === null)
  if (!blank) return
  into.push(makeConflict({
    kind: 'unknown_facts',
    reason: `成交编号未知，不能把这笔效果计入${sourceLabel(candidate.source)} ${candidate.id}。`,
    goal_id: knownGoal(candidate.goal_id),
    holder: null,
    candidate: refOf(candidate, null),
    overlap: null,
    sale_id: null,
  }))
}

function makeConflict(conflict: ExclusiveClaimConflict): ExclusiveClaimConflict {
  return conflict
}

function refOf(claim: ExclusiveClaim, segmentKey: string | null): ClaimRef {
  return { source: claim.source, id: claim.id, segment_key: segmentKey }
}

function isSameClaim(a: ExclusiveClaim, b: ExclusiveClaim): boolean {
  return a.source === b.source && a.id.length > 0 && a.id === b.id
}

function goalRelation(holderGoal: string | null, candidateGoal: string | null): GoalRelation {
  const holder = knownGoal(holderGoal)
  const candidate = knownGoal(candidateGoal)
  if (!holder || !candidate) return 'unknown'
  return holder === candidate ? 'same' : 'different'
}

function knownGoal(id: string | null): string | null {
  if (!id || id.trim().length === 0) return null
  return id
}

function validWindow(window: DateWindow): ClosedWindow | null {
  const start = window.start_date
  const end = window.end_date
  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) return null
  if (start > end) return null
  return { start, end }
}

function intersect(left: ClosedWindow, right: ClosedWindow): ClosedWindow | null {
  const start = left.start > right.start ? left.start : right.start
  const end = left.end < right.end ? left.end : right.end
  if (start > end) return null
  return { start, end }
}

function moneyUnknown(budget: BudgetHold): boolean {
  if (budget.kind === 'unknown') return true
  if (budget.kind === 'amount' && (budget.amount_cents === null || budget.amount_cents < 0)) return true
  return false
}

function cleanSaleId(id: string): string | null {
  const trimmed = id.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pairText(holder: ExclusiveClaim, candidate: ExclusiveClaim): string {
  return `${sourceLabel(holder.source)} ${holder.id} 与${sourceLabel(candidate.source)} ${candidate.id}`
}

function sourceLabel(source: PrescriptionSource): string {
  switch (source) {
    case 'diagnostic_prescription':
      return '诊断处方'
    case 'marketing_plan':
      return '推广计划'
    case 'ads_daily':
      return '广告日处方'
  }
}
