/**
 * POST /api/clients/[id]/marketing-plan/[planId]/approve
 *
 * 批准 Plan：
 *   1. 把 status 从 draft → approved
 *   2. 调用 task-dispatcher 把 plan_data.tasks 批量插入 execution_items
 *   3. 返回派发结果
 *
 * 幂等性：如果 Plan 已是 approved 状态，返回当前状态，不重复派发。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { dispatchPlanTasks } from '@/lib/marketing-plan/task-dispatcher'
import type { MarketingPlan } from '@/lib/marketing-plan/types'

export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  try {
    // 1. 读 Plan
    const { data: plan, error: fetchErr } = await supabaseAdmin
      .from('marketing_plans')
      .select('*')
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .single()

    if (fetchErr) throw fetchErr
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }

    const planRow = plan as MarketingPlan

    // 2. 幂等：已批准则直接返回
    if (planRow.status === 'approved') {
      const { count } = await supabaseAdmin
        .from('execution_items')
        .select('id', { count: 'exact', head: true })
        .eq('marketing_plan_id', planRow.id)
      return NextResponse.json({
        success: true,
        plan: planRow,
        already_approved: true,
        existing_task_count: count ?? 0,
      })
    }

    // 3. 拒绝 archived/completed 状态
    if (planRow.status !== 'draft') {
      return NextResponse.json({
        success: false,
        error: `Cannot approve a plan with status="${planRow.status}". Only drafts can be approved.`,
      }, { status: 400 })
    }

    // 4. 派发任务（先派发，成功后再改状态 — 防止状态改了但任务未派发）
    const dispatchResult = await dispatchPlanTasks(planRow)

    // 5. 改状态
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('marketing_plans')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', params.planId)
      .select('*')
      .single()

    if (updateErr) {
      // 任务已派发但状态没改 — 记录警告但不抛错（让 PM 看到任务已存在）
      console.error('[marketing-plan approve] tasks dispatched but status update failed:', updateErr)
    }

    return NextResponse.json({
      success: true,
      plan: updated ?? planRow,
      dispatch: dispatchResult,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[marketing-plan approve] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
