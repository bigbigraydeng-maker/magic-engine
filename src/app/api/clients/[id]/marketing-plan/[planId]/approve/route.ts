/**
 * POST /api/clients/[id]/marketing-plan/[planId]/approve
 *
 * 批准 Plan：
 *   1. 把 status 从 draft → approved
 *   2. 调用 task-dispatcher 把 plan_data.tasks 批量插入 execution_items
 *   3. 返回派发结果
 *
 * 幂等性：如果 Plan 已是 approved 状态，返回当前状态，不重复派发。
 * 重试安全：派发中途失败时计划保持 draft，再点一次只会补派还没派过的任务
 * （dispatchPlanTasks 按「标题+截止日」跳过已存在的）。
 * 保证强度：应用层；两个人「同时」点批准仍可能各派一份内部待办（设计稿 §0.1，PM 已接受）。
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { dispatchPlanTasks } from '@/lib/marketing-plan/task-dispatcher'
import type { ApprovalReceipt, MarketingPlan } from '@/lib/marketing-plan/types'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

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

    // 5. 改状态 + 写批准回执（generation_meta 保存接口不接受，不会被覆盖）
    //    派发重试时已派过的任务会被跳过（dispatch.tasks_skipped），所以这里可以放心重试。
    const approvedAt = new Date().toISOString()
    const receipt: ApprovalReceipt = {
      request_id: randomUUID(),
      approved_by: access.user.email ?? null,
      approved_at: approvedAt,
      tasks_created: dispatchResult.tasks_created,
      tasks_skipped: dispatchResult.tasks_skipped ?? 0,
      packages_created: dispatchResult.packages_created,
    }
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('marketing_plans')
      .update({
        status: 'approved',
        approved_at: approvedAt,
        generation_meta: { ...(planRow.generation_meta ?? {}), approval_receipt: receipt },
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
      receipt,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[marketing-plan approve] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
