import { manualSource, MANUAL_PRESCRIPTION_AGENT } from '@/lib/diagnostic/manual-prescription'
import { collectAdPlays } from '@/lib/ads-strategy/plan-seed/attach'
import { parseCreativePool } from '@/lib/ads-strategy/config'
import { allAdsSteps, readPromoSpec } from '@/lib/marketing-plan/promo/spec'
import { planLinkedGoalId } from '@/lib/marketing-plan/promo/plan-pick'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PrescriptionContent } from '@/types/diagnostic'
import type {
  DraftFact,
  DraftRow,
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
const COST_THRESHOLD_METRIC = /暂停线|停投|止损|上限|保本|pause|stop|kill|cap|ceiling|break.?even/i
const EXPLICIT_TARGET_COST_METRIC = /目标线索成本|目标成本|target (lead )?cost|target cpl/i
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
    ...(row.client_kind === 'personal_ip' ? { personalIp: true } : {}),
  }
}

function costAmountFromKpi(kpi: Record<string, unknown>): number | null {
  const amount = finiteNumber(kpi.target_value)
  if (amount === null) return null
  const unit = String(kpi.unit ?? '')
  return CENTS_UNIT.test(unit) ? amount / 100 : amount
}

function targetCosts(content: Record<string, unknown>): number[] {
  const rows = content.kpi_targets
  if (!Array.isArray(rows)) return []
  const explicit: number[] = []
  const fallback: number[] = []
  for (const row of rows) {
    const kpi = asRecord(row)
    if (!kpi) continue
    const metric = String(kpi.metric ?? '')
    if (!COST_METRIC.test(metric)) continue
    const amount = costAmountFromKpi(kpi)
    if (amount === null) continue
    if (COST_THRESHOLD_METRIC.test(metric)) continue
    if (EXPLICIT_TARGET_COST_METRIC.test(metric)) {
      explicit.push(amount)
      continue
    }
    fallback.push(amount)
  }
  return explicit.length > 0 ? explicit : fallback
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
  const manual = record.agent_name === MANUAL_PRESCRIPTION_AGENT || manualSource(record.generation_meta)
  return {
    status: record.status,
    goalId: textOrNull(record.goal_id),
    approvedAt: textOrNull(record.approved_at),
    errorMessage: textOrNull(record.error_message),
    intake: intakeFrom(record.intake),
    manual,
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
    title: textOrNull(record.title),
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

function creativeIdsOf(payload: Record<string, unknown> | null): string[] {
  const draft = payload ? asRecord(payload.draft) : null
  const creatives = draft?.creatives
  if (!Array.isArray(creatives)) return []
  const ids: string[] = []
  for (const item of creatives) {
    const creative = asRecord(item)
    for (const value of [creative?.videoId, creative?.imageHash]) {
      const id = textOrNull(value)
      if (id) ids.push(id)
    }
  }
  return ids
}

/** A row with no id cannot be de-duplicated or linked, so it is rejected (caller says 读不到). */
export function parseDraftRow(row: unknown): DraftRow | null {
  const record = asRecord(row)
  if (!record || typeof record.id !== 'string') return null
  return {
    id: record.id,
    status: parseDraft(row).status,
    executionItemId: textOrNull(record.execution_item_id),
    creativeIds: creativeIdsOf(asRecord(record.payload)),
  }
}
