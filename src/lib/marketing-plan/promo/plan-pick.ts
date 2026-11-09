/**
 * 推广计划页打开哪一份。
 * 建空白草稿时目标已经记在 generation_meta.blank_draft，不必再保存一次推广表单。
 * 同一目标下优先打开已批准的计划（较新的优先），没有已批准的才打开较新的草稿。
 * 这样自动起草的未批准草稿不会把正在用的已批准计划挤出页面和作战地图。
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

function byCreatedDesc<T extends PlanPick>(plans: readonly T[]): T[] {
  return plans
    .filter(plan => plan.status !== 'archived')
    .slice()
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

/** 同一目标：最新的已批准计划优先；没有已批准的，才取最新的未归档计划。 */
function pickLinked<T extends PlanPick>(newestFirst: readonly T[], goalId: string): T | null {
  const linked = newestFirst.filter(plan => planLinkedGoalId(plan) === goalId)
  return linked.find(plan => plan.status === 'approved') ?? linked[0] ?? null
}

/** 列表按创建时间从新到旧看。对得上处方目标的计划优先于别的目标上更早的计划。 */
export function pickPlanForPrescription<T extends PlanPick>(
  plans: readonly T[],
  prescriptionGoalId: string | null,
): T | null {
  const newestFirst = byCreatedDesc(plans)
  const goalId = prescriptionGoalId?.trim() ?? ''
  if (goalId !== '') {
    const linked = pickLinked(newestFirst, goalId)
    if (linked) return linked
  }
  return newestFirst.find(plan => plan.status === 'approved' && hasPromo(plan))
    ?? newestFirst.find(plan => plan.status === 'draft' && hasPromo(plan))
    ?? newestFirst.find(plan => plan.status === 'draft')
    ?? null
}

export interface WarMapPlanRow {
  status: string
  updated_at: string | null
  plan_data: unknown
}

function byUpdatedDesc<T extends WarMapPlanRow>(rows: readonly T[]): T[] {
  return rows.slice().sort((left, right) => (right.updated_at ?? '').localeCompare(left.updated_at ?? ''))
}

/** 作战地图：能读出推广结构的已批准计划优先于更新的草稿。读不出结构的行跳过。 */
export function pickWarMapPlan<T extends WarMapPlanRow>(rows: readonly T[]): T | null {
  const readable = byUpdatedDesc(rows.filter(row => readPromoSpec(row.plan_data) !== null))
  return readable.find(row => row.status === 'approved')
    ?? readable.find(row => row.status === 'draft')
    ?? null
}
