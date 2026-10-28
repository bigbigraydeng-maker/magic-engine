/**
 * Reads the numbers an effect-judgment card is allowed to use.
 * Goal, approved cost, daily cap, account-history median, and the existing pace rule.
 * A failed read stays empty. This file does not write and does not call Meta.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { loadAdStrategyConfigWithSource } from '@/lib/ads-strategy/config'
import { ADS_ATTRIBUTABLE_METRIC_KEYS, medianCostPerResultCents } from '@/lib/ads-strategy/portfolio/goal-context'
import { loadOutcomeConfig } from '@/lib/ads-strategy/portfolio/outcome-config'
import { todayInNz } from '@/lib/marketing-plan/promo/schedule-view'
import { autoFetchMetricValue } from '@/lib/strategy/auto-fetch'
import type { PrescriptionContent } from '@/types/diagnostic'
import type { GoalRow } from '@/types/strategy'
import {
  buildEffectJudgmentCard, prescriptionCostReadings,
  type EffectGoal, type EffectJudgmentCard, type ReadState,
} from './card'

const LOAD_ERROR = '量这些数时没有读成，效果判断卡先空着。'

export async function loadEffectJudgmentCard(input: {
  clientId: string
  goal: GoalRow | null
  content: PrescriptionContent | null
  now?: Date
}): Promise<EffectJudgmentCard> {
  try {
    return await readCard(input)
  } catch (err) {
    console.warn('[effect-judgment] load failed', err instanceof Error ? err.message : 'unknown')
    return buildEffectJudgmentCard(failedSources(LOAD_ERROR))
  }
}

async function readCard(input: {
  clientId: string
  goal: GoalRow | null
  content: PrescriptionContent | null
  now?: Date
}): Promise<EffectJudgmentCard> {
  const now = input.now ?? new Date()
  const today = todayInNz(now)
  const [approved, cap] = await Promise.all([
    readApprovedCost(input.clientId),
    readDailyCap(input.clientId),
  ])
  const goal = goalOf(input.goal)
  const actualToDate = goal ? await readActual(input.clientId, input.goal, now) : null
  const medianCostCents = goal ? await readMedian(input.clientId, today) : null
  return buildEffectJudgmentCard({
    goal,
    approvedCost: approved.cost,
    approvedCostState: approved.state,
    prescriptionCosts: prescriptionCostReadings(input.content?.kpi_targets ?? []),
    dailyCapCents: cap.cents,
    dailyCapState: cap.state,
    today,
    actualToDate,
    medianCostCents,
    sampleDays: null,
    loadError: null,
  })
}

async function readApprovedCost(clientId: string): Promise<{ state: ReadState; cost: { amount: number; currency: string | null } | null }> {
  const loaded = await loadOutcomeConfig(clientId)
  if (loaded.source === 'read_error') return { state: 'unreadable', cost: null }
  const amount = loaded.config.targetCostPerPrimary
  if (amount == null) return { state: 'missing', cost: null }
  return { state: 'value', cost: { amount, currency: null } }
}

async function readDailyCap(clientId: string): Promise<{ state: ReadState; cents: number | null }> {
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  if (loaded.source === 'fallback') return { state: 'unreadable', cents: null }
  const cents = loaded.config.daily_budget_cap_cents
  if (cents == null) return { state: 'missing', cents: null }
  return { state: 'value', cents }
}

async function readActual(clientId: string, goal: GoalRow | null, now: Date): Promise<number | null> {
  if (!goal || !ADS_ATTRIBUTABLE_METRIC_KEYS.has(goal.primary_metric_key)) return null
  const fetched = await autoFetchMetricValue(supabaseAdmin, clientId, goal.primary_metric_key, {
    goalPeriod: { period_start: goal.period_start, period_end: goal.period_end },
    now,
  })
  if (!fetched.ok) return null
  return Number.isFinite(fetched.value) ? fetched.value : null
}

async function readMedian(clientId: string, today: string): Promise<number | null> {
  return medianCostPerResultCents(clientId, today)
}

function goalOf(goal: GoalRow | null): EffectGoal | null {
  if (!goal) return null
  return {
    periodStart: goal.period_start,
    periodEnd: goal.period_end,
    targetValue: goal.target_value,
    baselineValue: goal.baseline_value,
    budgetCurrency: goal.budget_currency,
  }
}

function failedSources(loadError: string) {
  return {
    goal: null,
    approvedCost: null,
    approvedCostState: 'unreadable' as const,
    prescriptionCosts: [],
    dailyCapCents: null,
    dailyCapState: 'unreadable' as const,
    today: '',
    actualToDate: null,
    medianCostCents: null,
    sampleDays: null,
    loadError,
  }
}
