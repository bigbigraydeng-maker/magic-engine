/**
 * After a budget has been raised, propose putting that ad set back.
 * Either signal is enough. A missing number is not a zero, and a stale
 * snapshot is not a reason to guess. These ratios are platform defaults.
 */

import { createHash } from 'node:crypto'
import { hasOpenBudgetHold, restoreCents, type ChainStep } from './chain'

/** 1.3 as 13/10. Spending exactly 1.3 times the target does not fire. */
export const FALLBACK_CPL_OVER_NUM = 13
export const FALLBACK_CPL_OVER_DEN = 10
/** Half the daily budget. Spending exactly half does fire. */
export const FALLBACK_SPEND_NUM = 1
export const FALLBACK_SPEND_DEN = 2

export type FallbackReason = 'cpl' | 'zero_leads'

export interface FallbackDay {
  readonly spendCents: number | null
  readonly leads: number | null
}

export interface FallbackAdSet {
  readonly adsetId: string
  readonly campaignId: string | null
  readonly delivering: boolean
  readonly dailyBudgetCents: number | null
}

export interface FallbackCampaign {
  readonly id: string
  readonly delivering: boolean
  readonly dailyBudgetCents: number | null
}

export interface FallbackInput {
  readonly stage: 'scale' | 'other' | 'unreadable'
  readonly targetCents: number | null
  readonly capCents: number | null
  readonly fresh: boolean
  readonly timezoneKnown: boolean
  readonly truncated: boolean
  readonly yesterday: string | null
  readonly dayBefore: string | null
  readonly currency: string | null
  readonly adsets: readonly FallbackAdSet[]
  readonly campaigns: readonly FallbackCampaign[]
  readonly days: Readonly<Record<string, { yesterday?: FallbackDay; dayBefore?: FallbackDay }>>
  readonly actions: readonly ChainStep[]
}

export interface ScaleFallbackProposal {
  readonly subjectKey: string
  readonly currentCents: number
  readonly restoreCents: number
  readonly currency: string | null
  readonly yesterday: string
  readonly dayBefore: string
  readonly reasons: readonly FallbackReason[]
}

export function judgeScaleFallback(input: FallbackInput): readonly ScaleFallbackProposal[] {
  if (!ready(input) || input.targetCents === null || input.capCents === null) return []
  if (!input.yesterday || !input.dayBefore) return []
  const room = committedExcept(input)
  if (room === null) return []
  const out: ScaleFallbackProposal[] = []
  for (const adset of input.adsets) {
    const proposal = oneAdSet(input, adset, room, input.targetCents, input.capCents, input.yesterday, input.dayBefore)
    if (proposal) out.push(proposal)
  }
  return out
}

function ready(input: FallbackInput): boolean {
  return input.stage === 'scale' && input.fresh && input.timezoneKnown && !input.truncated
}

function oneAdSet(
  input: FallbackInput,
  adset: FallbackAdSet,
  room: number,
  targetCents: number,
  capCents: number,
  yesterday: string,
  dayBefore: string,
): ScaleFallbackProposal | null {
  const current = ownBudget(input, adset)
  if (current === null || hasOpenBudgetHold(input.actions, adset.adsetId)) return null
  const restore = restoreCents(input.actions, adset.adsetId, current)
  const nextTotal = room - current + (restore ?? 0)
  if (restore === null || restore >= current || restore > capCents || nextTotal > capCents) return null
  const reasons = reasonsFor(input.days[adset.adsetId], targetCents, current)
  if (reasons.length === 0) return null
  return {
    subjectKey: subjectFor(adset.adsetId),
    currentCents: current,
    restoreCents: restore,
    currency: currencyOf(input.currency),
    yesterday,
    dayBefore,
    reasons,
  }
}

function ownBudget(input: FallbackInput, adset: FallbackAdSet): number | null {
  if (!adset.delivering || !positive(adset.dailyBudgetCents)) return null
  if (adset.campaignId && campaignOwnsBudget(input.campaigns, adset.campaignId)) return null
  return adset.dailyBudgetCents
}

function reasonsFor(
  days: { yesterday?: FallbackDay; dayBefore?: FallbackDay } | undefined,
  targetCents: number,
  budgetCents: number,
): FallbackReason[] {
  const reasons: FallbackReason[] = []
  if (overTarget(days?.yesterday, targetCents) && overTarget(days?.dayBefore, targetCents)) reasons.push('cpl')
  if (halfSpent(days?.yesterday, budgetCents)) reasons.push('zero_leads')
  return reasons
}

function overTarget(day: FallbackDay | undefined, targetCents: number): boolean {
  if (!day || day.spendCents === null || day.leads === null || day.leads <= 0) return false
  const left = day.spendCents * FALLBACK_CPL_OVER_DEN
  const right = targetCents * FALLBACK_CPL_OVER_NUM * day.leads
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return false
  return left > right
}

function halfSpent(day: FallbackDay | undefined, budgetCents: number): boolean {
  if (!day || day.spendCents === null || day.leads !== 0) return false
  const left = day.spendCents * FALLBACK_SPEND_DEN
  const right = budgetCents * FALLBACK_SPEND_NUM
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return false
  return left >= right
}

function committedExcept(input: FallbackInput): number | null {
  let total = 0
  for (const adset of input.adsets) {
    if (!adset.delivering) continue
    const campaignBudget = adset.campaignId ? campaignBudgetOf(input.campaigns, adset.campaignId) : null
    if (positive(campaignBudget)) continue
    if (!positive(adset.dailyBudgetCents)) return null
    total += adset.dailyBudgetCents
  }
  for (const campaign of input.campaigns) {
    if (!campaign.delivering || !positive(campaign.dailyBudgetCents)) continue
    total += campaign.dailyBudgetCents
  }
  return Number.isSafeInteger(total) ? total : null
}

function campaignOwnsBudget(campaigns: readonly FallbackCampaign[], id: string): boolean {
  return positive(campaignBudgetOf(campaigns, id))
}

function campaignBudgetOf(campaigns: readonly FallbackCampaign[], id: string): number | null {
  const row = campaigns.find((campaign) => campaign.id === id)
  return row?.dailyBudgetCents ?? null
}

function positive(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0
}

function currencyOf(value: string | null): string | null {
  return value && /^[A-Z]{3}$/.test(value) ? value : null
}

function subjectFor(adsetId: string): string {
  return `scale-back-${createHash('sha256').update(adsetId).digest('hex').slice(0, 16)}`
}
