/**
 * 写入一条空白营销计划草稿。只读目标、只插入一行。
 * 不更新别的计划，不调用生成，不派待办。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { buildBlankDraftInsert, type BlankDraftGoal } from './blank-draft'
import type { MarketingPlan } from './types'

export type CreateBlankDraftResult =
  | { ok: true; plan: MarketingPlan }
  | { ok: false; status: 400 | 500; error: string }

export async function createBlankDraftPlan(
  clientId: string,
  goalId: string,
): Promise<CreateBlankDraftResult> {
  const loaded = await loadGoalForClient(clientId, goalId)
  if (!loaded.ok) return loaded
  const built = buildBlankDraftInsert(clientId, loaded.goal)
  if (!built.ok) return { ok: false, status: 400, error: built.error }
  const { data, error } = await supabaseAdmin
    .from('marketing_plans')
    .insert(built.row)
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, status: 500, error: error?.message || '保存草稿失败' }
  }
  return { ok: true, plan: data as MarketingPlan }
}

async function loadGoalForClient(
  clientId: string,
  goalId: string,
): Promise<{ ok: true; goal: BlankDraftGoal } | { ok: false; status: 400 | 500; error: string }> {
  const { data, error } = await supabaseAdmin
    .from('goals')
    .select('id, title, status, period_start, period_end')
    .eq('id', goalId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: '读取目标失败，没有新建计划' }
  if (!data) return { ok: false, status: 400, error: '目标不存在或不属于这个客户' }
  return { ok: true, goal: data as BlankDraftGoal }
}
