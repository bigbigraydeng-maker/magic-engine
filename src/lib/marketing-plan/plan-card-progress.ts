/** Read the plan behind an authorized card before claiming that approval finished. */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { readStoredCard, type ConfirmationCardView } from '@/lib/confirmation-card/view'
import { contentHashOf } from './approve-plan'
import { parsePlanCardDate, trustedPlanCard } from './plan-card-subject'
import type { MarketingPlan } from './types'

export function approvedPlanView(card: ConfirmationCardView): ConfirmationCardView {
  return {
    ...card,
    status: 'confirmed',
    statusLine: '确认已记录。这份计划已批准。还没开投，不会花钱。',
    confirmEnabled: false,
    declineEnabled: false,
    blockedReason: null,
  }
}

export function pendingPlanView(
  card: ConfirmationCardView,
  clicker: CardClicker,
  message: string,
  retryable: boolean,
): ConfirmationCardView {
  return {
    ...card,
    status: 'pending_application',
    statusLine: `确认已记录，但这份计划尚未批准。${message}`,
    confirmEnabled: retryable && clicker.kind === 'opc',
    declineEnabled: false,
    blockedReason: null,
  }
}

/** Shown when confirm must not touch the plan: revoked, archived, or replaced. */
export const PLAN_CARD_EXPIRED = '这张卡已过期'

/** Set on the run once this card's confirm has been applied to the plan. */
export const PLAN_APPROVAL_APPLIED_KEY = 'plan_approval_applied'

export function planApprovalApplied(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false
  const mark = (evidence as Record<string, unknown>)[PLAN_APPROVAL_APPLIED_KEY]
  return !!mark && typeof mark === 'object' && !Array.isArray(mark)
}

export function expiredPlanView(card: ConfirmationCardView): ConfirmationCardView {
  return {
    ...card,
    status: 'expired',
    statusLine: PLAN_CARD_EXPIRED,
    confirmEnabled: false,
    declineEnabled: false,
    blockedReason: null,
  }
}

export async function reconcilePlanCardViews(
  sb: SupabaseClient,
  clientId: string,
  clicker: CardClicker,
  cards: readonly ConfirmationCardView[],
  inputs: ReadonlyMap<string, Record<string, unknown>>,
  evidenceByRun: ReadonlyMap<string, unknown>,
): Promise<ConfirmationCardView[]> {
  const subjects = new Map<string, { planId: string; contentHash: string; start: string | null; end: string | null }>()
  for (const card of cards) {
    if (card.status !== 'confirmed') continue
    const stored = readStoredCard(inputs.get(card.runId) ?? {})
    const subject = stored ? trustedPlanCard(stored) : null
    const dates = stored ? parsePlanCardDate(stored.date) : null
    if (subject) subjects.set(card.runId, { ...subject, start: dates?.start ?? null, end: dates?.end ?? null })
  }
  if (subjects.size === 0) return [...cards]
  const ids = [...new Set([...subjects.values()].map((subject) => subject.planId))]
  const { data, error } = await sb
    .from('marketing_plans')
    .select('id, status, plan_data, start_date, end_date')
    .eq('client_id', clientId)
    .in('id', ids)
  if (error) throw new Error(`[plan-card] 读取计划状态失败：${error.message}`)
  const plans = new Map((data ?? []).map((plan) => [plan.id, plan as MarketingPlan]))
  return cards.map((card) => {
    const subject = subjects.get(card.runId)
    if (!subject) return card
    return viewForPlan(
      card,
      clicker,
      planApprovalApplied(evidenceByRun.get(card.runId)),
      subject,
      plans.get(subject.planId),
    )
  })
}

function viewForPlan(
  card: ConfirmationCardView,
  clicker: CardClicker,
  applied: boolean,
  subject: { contentHash: string; start: string | null; end: string | null },
  plan: MarketingPlan | undefined,
): ConfirmationCardView {
  if (!subject.start || !subject.end || !plan) {
    return applied
      ? expiredPlanView(card)
      : pendingPlanView(card, clicker, '找不到卡上这份计划，或日期对不上，请到计划页核实。', false)
  }
  const sameContent = contentHashOf(plan) === subject.contentHash
  const sameDates = plan.start_date === subject.start && plan.end_date === subject.end
  if (!sameContent || !sameDates || plan.status === 'archived') return expiredPlanView(card)
  if (plan.status === 'approved') return approvedPlanView(card)
  // A draft after this card already applied the approval is a revoke, not a failed save.
  if (plan.status === 'draft' && applied) return expiredPlanView(card)
  if (plan.status === 'draft') return pendingPlanView(card, clicker, '请再次点确认重试批准。', true)
  return pendingPlanView(card, clicker, '计划已不是草稿，请到计划页核实。', false)
}
