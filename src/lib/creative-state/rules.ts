/**
 * Creative test → scale → retire. Pure. No network, no database.
 * Target cost comes from the client row. Missing target means no card.
 */

import { OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS } from '@/lib/ads-strategy/portfolio/diagnostics/thresholds'

export const CONSERVATIVE_CREATIVE_RULES = {
  minLiveDays: 7,
  minLeads: 10,
  retireMultiple: 1.5,
  maxPromotionCardsPerDay: 1,
  snapshotMaxAgeHours: OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS,
} as const

export interface CreativeRules {
  readonly targetCpl: number | null
  readonly minLiveDays: number
  readonly minLeads: number
  readonly retireMultiple: number
  readonly maxPromotionCardsPerDay: number
  readonly snapshotMaxAgeHours: number
}

export interface CaptureFact {
  readonly accountId: string
  readonly complete: boolean
  readonly capturedAt: string
}

export type CreativeStage = 'test' | 'scale'

export interface LiveCreative {
  readonly adId: string
  readonly name: string
  readonly stage: CreativeStage
  readonly status: 'ACTIVE'
  readonly liveDays: number
  readonly leads: number
  readonly spend: number
  readonly postId: string | null
  readonly pageId: string | null
  readonly adAccountId: string
  readonly adsetId: string
}

export interface ScaleRoom {
  readonly adsetId: string | null
  readonly dailyBudget: number | null
  readonly spentToday: number | null
}

export interface PlanRoom {
  readonly approvedDailyCap: number | null
  readonly committedDaily: number | null
}

export type CreativeProposal =
  | { readonly kind: 'move_to_scale'; readonly ad: LiveCreative; readonly scaleAdsetId: string }
  | {
      readonly kind: 'new_plan'
      readonly ad: LiveCreative
      readonly scaleAdsetId: string
      readonly raiseDaily: number
      readonly nextDailyTotal: number
    }
  | { readonly kind: 'pause'; readonly ad: LiveCreative }

export interface CreativeDecision {
  readonly proposals: readonly CreativeProposal[]
  readonly skipped: readonly string[]
}

export function rulesFromConfig(row: {
  target_cost_per_primary?: unknown
  min_primary_per_unit?: unknown
} | null): CreativeRules {
  const target = positive(row?.target_cost_per_primary)
  const configured = whole(row?.min_primary_per_unit)
  const minLeads = Math.max(CONSERVATIVE_CREATIVE_RULES.minLeads, configured ?? 0)
  return { ...CONSERVATIVE_CREATIVE_RULES, targetCpl: target, minLeads }
}

export function capturesFresh(rows: readonly CaptureFact[], now: Date, maxAgeHours: number): boolean {
  if (rows.length === 0) return false
  return rows.every((row) => oneCaptureFresh(row, now, maxAgeHours))
}

export function decideCreatives(input: {
  rules: CreativeRules
  captures: readonly CaptureFact[]
  creatives: readonly LiveCreative[]
  scale: ScaleRoom
  plan: PlanRoom
  promotionsToday: number
  now: Date
}): CreativeDecision {
  const skipped: string[] = []
  if (input.rules.targetCpl === null) return { proposals: [], skipped: ['no_target'] }
  if (!capturesFresh(input.captures, input.now, input.rules.snapshotMaxAgeHours)) {
    return { proposals: [], skipped: ['stale_snapshot'] }
  }
  const pauses = input.creatives.filter((ad) => shouldRetire(ad, input.rules)).map(pauseOf)
  const promotion = pickPromotion(input, skipped)
  return { proposals: promotion ? [promotion, ...pauses] : pauses, skipped }
}

function pickPromotion(
  input: Parameters<typeof decideCreatives>[0],
  skipped: string[],
): CreativeProposal | null {
  if (input.promotionsToday >= input.rules.maxPromotionCardsPerDay) {
    skipped.push('promotion_cap')
    return null
  }
  const winner = [...input.creatives].filter((ad) => isWinner(ad, input.rules)).sort(byCost)[0]
  if (!winner) return null
  const room = roomFor(winner, input.scale, input.plan)
  if (room.kind === 'skip') {
    skipped.push(room.reason)
    return null
  }
  return room.kind === 'move'
    ? { kind: 'move_to_scale', ad: winner, scaleAdsetId: room.scaleAdsetId }
    : { kind: 'new_plan', ad: winner, scaleAdsetId: room.scaleAdsetId, raiseDaily: room.raiseDaily, nextDailyTotal: room.nextDailyTotal }
}

function shouldRetire(ad: LiveCreative, rules: CreativeRules): boolean {
  const target = rules.targetCpl
  if (target === null || ad.liveDays < rules.minLiveDays) return false
  if (ad.spend < rules.minLeads * target) return false
  if (ad.leads <= 0) return true
  return ad.spend / ad.leads > rules.retireMultiple * target
}

function isWinner(ad: LiveCreative, rules: CreativeRules): boolean {
  const target = rules.targetCpl
  if (target === null || ad.stage !== 'test') return false
  if (ad.liveDays < rules.minLiveDays || ad.leads < rules.minLeads) return false
  return ad.spend / ad.leads <= target
}

function roomFor(ad: LiveCreative, scale: ScaleRoom, plan: PlanRoom):
  | { kind: 'move'; scaleAdsetId: string }
  | { kind: 'plan'; scaleAdsetId: string; raiseDaily: number; nextDailyTotal: number }
  | { kind: 'skip'; reason: string } {
  if (!scale.adsetId) return { kind: 'skip', reason: 'no_scale_adset' }
  if (!ad.postId || !ad.pageId) return { kind: 'skip', reason: 'no_post' }
  if (scale.dailyBudget === null || scale.spentToday === null || !(scale.dailyBudget > 0)) {
    return { kind: 'skip', reason: 'scale_budget_unread' }
  }
  const pace = ad.spend / ad.liveDays
  const headroom = scale.dailyBudget - scale.spentToday
  if (pace <= headroom) return { kind: 'move', scaleAdsetId: scale.adsetId }
  if (plan.approvedDailyCap === null || plan.committedDaily === null) {
    return { kind: 'skip', reason: 'plan_cap_unread' }
  }
  const raiseDaily = pace - headroom
  const nextDailyTotal = plan.committedDaily + raiseDaily
  if (nextDailyTotal > plan.approvedDailyCap) return { kind: 'skip', reason: 'over_plan_cap' }
  return { kind: 'plan', scaleAdsetId: scale.adsetId, raiseDaily, nextDailyTotal }
}

function pauseOf(ad: LiveCreative): CreativeProposal {
  return { kind: 'pause', ad }
}

function byCost(a: LiveCreative, b: LiveCreative): number {
  const left = a.spend / a.leads
  const right = b.spend / b.leads
  if (left !== right) return left - right
  return a.adId < b.adId ? -1 : 1
}

function oneCaptureFresh(row: CaptureFact, now: Date, maxAgeHours: number): boolean {
  if (row.complete !== true) return false
  const at = Date.parse(row.capturedAt)
  if (!Number.isFinite(at)) return false
  const age = now.getTime() - at
  return age >= 0 && age <= maxAgeHours * 3_600_000
}

function positive(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function whole(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number.NaN
  return Number.isInteger(amount) && amount >= 1 ? amount : null
}
