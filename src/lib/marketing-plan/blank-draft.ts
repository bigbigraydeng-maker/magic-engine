/**
 * 空白营销计划草稿的纯规则。
 *
 * marketing_plans 没有目标列，也没有版本号。目标编号记在 generation_meta.blank_draft，
 * plan_data 里不放 promo，等已有的保存接口（只写草稿）再补推广结构。
 * 不生成内容、不批准、不派待办，也不改任何已有计划。
 */

import type { MarketingPlan, MarketingPlanData } from './types'

const USABLE_GOAL_STATUSES = new Set(['draft', 'active'])
const MIGRATION_PLACEHOLDER = '[Migration] Unassigned Backlog'

export interface BlankDraftGoal {
  id: string
  title: string | null
  status: string
  period_start: string | null
  period_end: string | null
}

export interface BlankDraftInsert {
  client_id: string
  campaign_id: null
  master_brief_id: null
  initiative_id: null
  title: string
  status: 'draft'
  start_date: string | null
  end_date: string | null
  plan_data: MarketingPlanData
  generation_meta: { blank_draft: { goal_id: string } }
  approved_at: null
}

export function readBlankDraftGoalId(meta: MarketingPlan['generation_meta']): string {
  const id = meta?.blank_draft?.goal_id
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : ''
}

export function assessGoalForBlankDraft(
  goal: BlankDraftGoal | null,
): { ok: true; title: string } | { ok: false; error: string } {
  if (!goal) return { ok: false, error: '目标不存在或不属于这个客户' }
  if (!USABLE_GOAL_STATUSES.has(goal.status)) {
    return { ok: false, error: '只能挂草稿或进行中的目标' }
  }
  const title = (goal.title ?? '').trim()
  if (!title || title === MIGRATION_PLACEHOLDER) {
    return { ok: false, error: '这个目标没有可用的标题' }
  }
  return { ok: true, title }
}

/** 插入行。plan_data 没有 promo 键，状态固定为草稿。 */
export function buildBlankDraftInsert(
  clientId: string,
  goal: BlankDraftGoal,
): { ok: true; row: BlankDraftInsert } | { ok: false; error: string } {
  const assessed = assessGoalForBlankDraft(goal)
  if (!assessed.ok) return assessed
  const planData: MarketingPlanData = {
    social: {},
    blog: { monthly_count: 0, topics: [] },
    kpis: {},
    tasks: [],
  }
  return {
    ok: true,
    row: {
      client_id: clientId,
      campaign_id: null,
      master_brief_id: null,
      initiative_id: null,
      title: assessed.title,
      status: 'draft',
      start_date: goal.period_start,
      end_date: goal.period_end,
      plan_data: planData,
      generation_meta: { blank_draft: { goal_id: goal.id } },
      approved_at: null,
    },
  }
}
