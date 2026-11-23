/**
 * Defaults and client overrides for post-execution budget / pause review.
 * Metric focus: cost per primary outcome (CPL family). No new tables.
 */

import type { OutcomeStep } from '@/lib/ads-strategy/portfolio/outcome-ladder'
import { loadOutcomeConfig } from '@/lib/ads-strategy/portfolio/outcome-config'
import { resolveTargetCplMajor } from '@/lib/ads-strategy/client-target-cpl'
import { supabaseAdmin } from '@/lib/supabase'
import {
  BUDGET_CARD_ACTION,
  PAUSE_CARD_ACTION,
  type ReviewWindowKind,
} from './executed-review'
import type { ObjectDay } from './object-window'
import { objectWindowDates } from './object-window'
import type { OutcomeVerdict } from '../adapters/types'
import { getMetricPolarity } from '../polarity'

export const ADS_EXECUTION_REVIEW_CONFIG_KEY = 'ads_execution_review'

export interface ReviewVerdictRules {
  readonly budgetWindowDays: number
  readonly pauseWindowDays: number
  readonly moneyBudgetWindowDays: number
  readonly moneyPauseWindowDays: number
  readonly campaignPauseWindowDays: number
  readonly marginPct: number
  readonly minPrimaryOutcomes: number
}

export const DEFAULT_REVIEW_VERDICT_RULES: ReviewVerdictRules = {
  budgetWindowDays: 7,
  pauseWindowDays: 3,
  moneyBudgetWindowDays: 7,
  moneyPauseWindowDays: 7,
  campaignPauseWindowDays: 7,
  marginPct: 15,
  minPrimaryOutcomes: 5,
}

export type ReviewVerdictTier = 'useful' | 'not_useful' | 'unclear'

export interface ClientReviewContext {
  readonly rules: ReviewVerdictRules
  readonly targetCostPerPrimary: number | null
  readonly primary: OutcomeStep | null
}

function whole(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null
  return value
}

function percent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) return null
  return value
}

export function rulesFromLeadsConfig(leadsConfig: unknown): ReviewVerdictRules {
  const base = DEFAULT_REVIEW_VERDICT_RULES
  const root = objectOf(leadsConfig)
  const block = objectOf(root?.[ADS_EXECUTION_REVIEW_CONFIG_KEY])
  if (!block) return base
  return {
    budgetWindowDays: whole(block.budget_window_days, 1, 28) ?? base.budgetWindowDays,
    pauseWindowDays: whole(block.pause_window_days, 1, 28) ?? base.pauseWindowDays,
    moneyBudgetWindowDays: whole(block.money_budget_window_days, 1, 28) ?? base.moneyBudgetWindowDays,
    moneyPauseWindowDays: whole(block.money_pause_window_days, 1, 28) ?? base.moneyPauseWindowDays,
    campaignPauseWindowDays: whole(block.campaign_pause_window_days, 1, 28) ?? base.campaignPauseWindowDays,
    marginPct: percent(block.margin_pct) ?? base.marginPct,
    minPrimaryOutcomes: whole(block.min_primary_outcomes, 1, 100) ?? base.minPrimaryOutcomes,
  }
}

function validCardWindowDays(cardWindowDays: number): boolean {
  return Number.isInteger(cardWindowDays) && cardWindowDays >= 1 && cardWindowDays <= 28
}

export function observationWindowForKind(
  kind: ReviewWindowKind,
  rules: ReviewVerdictRules,
  cardWindowDays: number,
): number {
  if (kind === 'budget_adset') return rules.budgetWindowDays
  if (kind === 'pause_adset') {
    if (validCardWindowDays(cardWindowDays)) return cardWindowDays
    return rules.pauseWindowDays
  }
  if (kind === 'money_budget') return rules.moneyBudgetWindowDays
  if (kind === 'money_pause') {
    if (validCardWindowDays(cardWindowDays)) return cardWindowDays
    return rules.moneyPauseWindowDays
  }
  if (kind === 'campaign_pause') {
    if (validCardWindowDays(cardWindowDays)) return cardWindowDays
    return rules.campaignPauseWindowDays
  }
  return cardWindowDays
}

/** @deprecated Prefer `observationWindowForKind` with `reviewWindowKindFor`. */
export function observationWindowForAction(
  actionType: string,
  rules: ReviewVerdictRules,
  cardWindowDays: number,
): number {
  if (actionType === BUDGET_CARD_ACTION) return rules.budgetWindowDays
  if (actionType === PAUSE_CARD_ACTION) {
    if (validCardWindowDays(cardWindowDays)) return cardWindowDays
    return rules.pauseWindowDays
  }
  return cardWindowDays
}

export function primaryCostMetric(primary: OutcomeStep | null): string {
  if (primary === 'lead') return 'ads.account.cost_per_lead'
  if (primary === 'messaging_started') return 'ads.account.cost_per_conversation'
  return 'ads.account.cpa'
}

export function countPrimaryOutcomesAfter(
  rows: readonly ObjectDay[],
  executedAt: string,
  windowDays: number,
  primary: OutcomeStep | null,
): number {
  const span = objectWindowDates(executedAt, windowDays)
  if (!span) return 0
  const after = rows.filter((row) => row.insight_date >= span.start && row.insight_date < span.to)
  const key = primary === 'lead'
    ? 'leads'
    : primary === 'messaging_started'
      ? 'messaging_conversations'
      : 'results'
  let total = 0
  for (const row of after) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) total += value
  }
  return total
}

export interface ReviewScoreInput {
  readonly metric: string
  readonly before: number | null
  readonly after: number | null
  readonly targetCost: number | null
  readonly rules: ReviewVerdictRules
  readonly primaryOutcomeCount: number
}

export interface ReviewScoreResult {
  readonly storedVerdict: OutcomeVerdict
  readonly confidence: number
  readonly tier: ReviewVerdictTier
  readonly reason: string | null
}

const REASON = {
  sample: '观察期内主要成效不满 5 个，样本不够下结论',
  missing: '改前改后的主要成效成本没有齐',
  middle: '相对目标或改前，变化在 15% 以内',
  neutral: '这项指标本身不分变好或变差',
} as const

export function scoreReviewVerdict(input: ReviewScoreInput): ReviewScoreResult {
  const polarity = getMetricPolarity(input.metric)
  if (polarity === 'neutral') {
    return { storedVerdict: 'inconclusive', confidence: 0, tier: 'unclear', reason: REASON.neutral }
  }
  if (input.primaryOutcomeCount < input.rules.minPrimaryOutcomes) {
    return { storedVerdict: 'inconclusive', confidence: 0, tier: 'unclear', reason: REASON.sample }
  }
  if (input.before === null && input.after === null) {
    return { storedVerdict: 'inconclusive', confidence: 0, tier: 'unclear', reason: REASON.missing }
  }
  if (input.after === null) {
    return { storedVerdict: 'inconclusive', confidence: 0, tier: 'unclear', reason: REASON.missing }
  }

  const margin = input.rules.marginPct
  const lowerIsBetter = polarity === 'lower_is_better'
  if (!lowerIsBetter) {
    return { storedVerdict: 'inconclusive', confidence: 0, tier: 'unclear', reason: REASON.neutral }
  }

  const reference = input.targetCost ?? input.before
  if (reference === null || reference === 0) {
    return { storedVerdict: 'inconclusive', confidence: 0, tier: 'unclear', reason: REASON.missing }
  }

  const deltaPct = ((input.after - reference) / Math.abs(reference)) * 100
  const compareLabel = input.targetCost !== null ? '目标' : '改前'

  if (deltaPct <= -margin) {
    return {
      storedVerdict: 'confirmed',
      confidence: round2(Math.min(0.95, Math.abs(deltaPct) / 30)),
      tier: 'useful',
      reason: `改后主成效单次成本比${compareLabel}低 ${fmtPct(-deltaPct)} 以上`,
    }
  }
  if (deltaPct >= margin) {
    return {
      storedVerdict: 'reversed',
      confidence: round2(Math.min(0.95, deltaPct / 30)),
      tier: 'not_useful',
      reason: `改后主成效单次成本比${compareLabel}高 ${fmtPct(deltaPct)} 以上`,
    }
  }

  return {
    storedVerdict: 'inconclusive',
    confidence: 0.2,
    tier: 'unclear',
    reason: REASON.middle,
  }
}

export function verdictEnding(tier: ReviewVerdictTier): string {
  if (tier === 'useful') return '结论：有用。'
  if (tier === 'not_useful') return '结论：没用。'
  return '结论：看不出。'
}

export function tierLabelZh(tier: ReviewVerdictTier): string {
  if (tier === 'useful') return '有用'
  if (tier === 'not_useful') return '没用'
  return '看不出'
}

export async function loadClientReviewContext(clientId: string): Promise<ClientReviewContext> {
  const [outcome, client] = await Promise.all([
    loadOutcomeConfig(clientId),
    supabaseAdmin.from('clients').select('leads_config').eq('id', clientId).maybeSingle(),
  ])
  const leadsConfig = client.data && typeof client.data === 'object'
    ? (client.data as { leads_config?: unknown }).leads_config
    : null
  const rules = rulesFromLeadsConfig(leadsConfig)
  const targetFromOutcome = outcome.config.targetCostPerPrimary
  const targetFromResolve = resolveTargetCplMajor({
    leadsConfig,
    planRows: [],
  })
  const targetCostPerPrimary = targetFromOutcome ?? targetFromResolve
  return {
    rules,
    targetCostPerPrimary,
    primary: outcome.config.primary,
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function fmtPct(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10) / 10
  return `${rounded}%`
}
