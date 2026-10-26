/**
 * 推广计划页打开哪一份。
 * 建空白草稿时目标已经记在 generation_meta.blank_draft，不必再保存一次推广表单。
 * 有当前处方时，打开挂着这个目标的那一份（较新的优先），而不是更早的另一份。
 */

import type { MarketingPlan } from '../types'
import { readBlankDraftGoalId } from '../blank-draft'
import { readPromoSpec } from './spec'

type PlanPick = Pick<MarketingPlan, 'id' | 'status' | 'created_at' | 'plan_data' | 'generation_meta'>

export function planLinkedGoalId(plan: Pick<PlanPick, 'plan_data' | 'generation_meta'>): string {
  const fromForm = readPromoSpec(plan.plan_data)?.goal_id ?? ''
  if (fromForm !== '') return fromForm
  return readBlankDraftGoalId(plan.generation_meta)
}

function hasPromo(plan: PlanPick): boolean {
  if (!plan.plan_data || typeof plan.plan_data !== 'object') return false
  const promo = (plan.plan_data as { promo?: unknown }).promo
  return promo !== undefined && promo !== null
}

/** 列表按创建时间从新到旧看。处方目标对得上的计划优先于「有推广结构的更早计划」。 */
export function pickPlanForPrescription<T extends PlanPick>(
  plans: readonly T[],
  prescriptionGoalId: string | null,
): T | null {
  const newestFirst = plans
    .filter(plan => plan.status !== 'archived')
    .slice()
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
  const goalId = prescriptionGoalId?.trim() ?? ''
  if (goalId !== '') {
    const carrying = newestFirst.find(plan => planLinkedGoalId(plan) === goalId)
    if (carrying) return carrying
  }
  return newestFirst.find(plan => plan.status === 'approved' && hasPromo(plan))
    ?? newestFirst.find(plan => plan.status === 'draft' && hasPromo(plan))
    ?? newestFirst.find(plan => plan.status === 'draft')
    ?? null
}
