import { collectAdPlays } from '@/lib/ads-strategy/plan-seed/attach'
import { parseCreativePool } from '@/lib/ads-strategy/config'
import { allAdsSteps, readPromoSpec } from '@/lib/marketing-plan/promo/spec'
import { planLinkedGoalId } from '@/lib/marketing-plan/promo/plan-pick'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PrescriptionContent } from '@/types/diagnostic'
import type {
  DraftFact,
  GoalFact,
  IntakeFact,
  OutcomeFact,
  PlanFact,
  PoolFact,
  PrescriptionFact,
  StrategyFact,
  WorkOrderFact,
} from './types'

const DATE = /^\d{4}-\d{2}-\d{2}/
const COST_METRIC = /成本|cost/i
const CENTS_UNIT = /分|cent/i

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value.trim())) return null
  return value.trim().slice(0, 10)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function intakeFrom(raw: unknown): IntakeFact | null {
  const row = asRecord(raw)
  if (!row) return null
  return {
    businessGoal: textOrNull(row.business_goal),
    monthlyBudget: finiteNumber(row.monthly_budget_aud),
  }
}

function targetCosts(content: Record<string, unknown>): number[] {
  const rows = content.kpi_targets
  if (!Array.isArray(rows)) return []
  const costs: number[] = []
  for (const row of rows) {
    const kpi = asRecord(row)
    if (!kpi || !COST_METRIC.test(String(kpi.metric ?? ''))) continue
    const amount = finiteNumber(kpi.target_value)
    if (amount === null) continue
    const unit = String(kpi.unit ?? '')
    costs.push(CENTS_UNIT.test(unit) ? amount / 100 : amount)
  }
  return costs
}

function reviewAnchor(content: Record<string, unknown>): string | null {
  return dateOrNull(content.review_anchor) ?? dateOrNull(content.anchor_date)
}

/** Turn one prescriptions row into facts. Malformed content becomes "no plays", not a throw. */
export function parsePrescription(row: unknown): PrescriptionFact | null {
  const record = asRecord(row)
  if (!record || typeof record.status !== 'string') return null
  const content = asRecord(record.content)
  const plays = content ? collectAdPlays(content as unknown as PrescriptionContent) : []
  return {
    status: record.status,
    goalId: textOrNull(record.goal_id),
    approvedAt: textOrNull(record.approved_at),
    errorMessage: textOrNull(record.error_message),
    intake: intakeFrom(record.intake),
    contentPresent: content !== null,
    adPlayCount: plays.length,
    targetCosts: content ? targetCosts(content) : [],
    reviewAnchor: content ? reviewAnchor(content) : null,
  }
}

export function parseGoal(row: unknown): GoalFact | null {
  const record = asRecord(row)
  if (!record) return null
  return {
    targetValue: finiteNumber(record.target_value),
    baselineValue: finiteNumber(record.baseline_value),
    currentValue: finiteNumber(record.current_value),
    periodStart: dateOrNull(record.period_start),
    periodEnd: dateOrNull(record.period_end),
  }
}

export function parseOutcome(row: unknown): OutcomeFact {
  const record = asRecord(row)
  if (!record) return { configured: false, targetCostPerPrimary: null }
  const amount = finiteNumber(record.target_cost_per_primary)
  return {
    configured: true,
    targetCostPerPrimary: amount !== null && amount > 0 ? amount : null,
  }
}

function poolFrom(raw: unknown): PoolFact[] | null {
  if (raw === null || raw === undefined) return []
  if (!Array.isArray(raw)) return null
  return parseCreativePool(raw).map((entry) => ({
    ref: entry.ref,
    status: entry.status,
    aliasRefs: entry.alias_refs ?? [],
    promoWindow: entry.promo_window ?? null,
  }))
}

/** null pool means the column was present but not a list — caller must say 读不到. */
export function parseStrategy(row: unknown): StrategyFact | null {
  const record = asRecord(row)
  if (!record) return null
  const cap = finiteNumber(record.daily_budget_cap_cents)
  return {
    dailyCapCents: cap !== null && cap > 0 ? cap : null,
    pool: poolFrom(record.creative_pool),
  }
}

export function parsePlan(row: unknown): PlanFact | null {
  const record = asRecord(row)
  if (!record || typeof record.id !== 'string' || typeof record.status !== 'string') return null
  const createdAt = typeof record.created_at === 'string' ? record.created_at : ''
  const linked = planLinkedGoalId({
    plan_data: record.plan_data as MarketingPlan['plan_data'],
    generation_meta: record.generation_meta as MarketingPlan['generation_meta'],
  })
  const spec = readPromoSpec(record.plan_data)
  const ads = spec ? allAdsSteps(spec) : []
  const creativeRefs = ads.flatMap((item) => item.step.settings.creative_refs)
  return {
    id: record.id,
    status: record.status,
    createdAt,
    goalId: linked,
    adsStepCount: ads.length,
    creativeRefs,
  }
}

export function parseWorkOrder(row: unknown): WorkOrderFact | null {
  const record = asRecord(row)
  if (!record || typeof record.status !== 'string') return null
  return { status: record.status, updatedAt: textOrNull(record.updated_at) }
}

export function parseDraft(row: unknown): DraftFact {
  const record = asRecord(row)
  const payload = record ? asRecord(record.payload) : null
  const status = payload ? payload.status : null
  return { status: typeof status === 'string' && status.trim() !== '' ? status : 'unknown' }
}
