/**
 * GET   /api/clients/[id]/marketing-plan/[planId] — 单个 Plan 详情
 * PATCH /api/clients/[id]/marketing-plan/[planId] — 编辑 Plan 数据或状态
 * DELETE /api/clients/[id]/marketing-plan/[planId] — 归档（软删除）
 *
 * PATCH body 支持的字段：title, status, start_date, end_date, plan_data
 * 注意：批准操作 (status → approved) 用单独的 /approve 路由（要触发任务派发）
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { countRevokeBlockers, revokePlanTasks } from '@/lib/marketing-plan/task-dispatcher'
import type { MarketingPlan, MarketingPlanData, MarketingPlanStatus } from '@/lib/marketing-plan/types'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess, requirePlanApproverAccess } from '@/lib/auth/client-access'
import {
  PLAN_CONTENT_LOCKED_MESSAGE,
  PROMO_CHANGED_VIA_PATCH_MESSAGE,
  isRevertToDraft,
  lockedFieldsTouched,
  promoFieldChanged,
} from '@/lib/marketing-plan/plan-guard'

interface PatchBody {
  title?: string
  /** approved 状态必须通过 /approve 路由（触发任务派发）— 运行时校验 */
  status?: MarketingPlanStatus
  start_date?: string
  end_date?: string
  plan_data?: MarketingPlanData
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('marketing_plans')
      .select('*')
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .single()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }

    // 同时拉派发的任务数（仅 marketing_plan 来源）
    const { count } = await supabaseAdmin
      .from('execution_items')
      .select('id', { count: 'exact', head: true })
      .eq('marketing_plan_id', params.planId)

    return NextResponse.json({
      success: true,
      plan: data,
      dispatched_task_count: count ?? 0,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  const denied = await rejectAgentAdsBearer(req, {
    clientId: params.id,
    action: 'approve',
    resourceId: params.planId,
  })
  if (denied) return denied

  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const body = await req.json().catch(() => ({})) as PatchBody
    if (body.plan_data !== undefined && (body.plan_data === null || typeof body.plan_data !== 'object' || Array.isArray(body.plan_data))) {
      return NextResponse.json({ success: false, error: 'plan_data 必须是一个对象' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (body.title !== undefined)       updates.title      = body.title
    if (body.start_date !== undefined)  updates.start_date = body.start_date
    if (body.end_date !== undefined)    updates.end_date   = body.end_date
    if (body.plan_data !== undefined)   updates.plan_data  = body.plan_data
    if (body.status !== undefined) {
      if (body.status === 'approved') {
        return NextResponse.json({
          success: false,
          error: 'Use POST /[planId]/approve to approve a plan (triggers task dispatch).',
        }, { status: 400 })
      }
      if (body.status === 'archived') {
        return NextResponse.json({
          success: false,
          error: 'Use DELETE to archive a plan (clears its pending tasks).',
        }, { status: 400 })
      }
      updates.status = body.status
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 })
    }

    // 已批准 / 已完成的计划内容被锁住：批准的是 A，就不能悄悄改成 B 继续跑。
    // 要改内容就先退回草稿（status: 'draft'），退回时清掉还没开始的待办。
    const { data: current, error: currentErr } = await supabaseAdmin
      .from('marketing_plans')
      .select('status, plan_data, generation_meta, updated_at')
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .maybeSingle<{ status: MarketingPlanStatus; plan_data: unknown; generation_meta: MarketingPlan['generation_meta']; updated_at: string }>()
    if (currentErr) throw currentErr
    if (!current) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }

    // 推广结构只能走专用保存接口（那里才核对目标 / 账户 / 预算）；通用保存不能改它，也不能把它删掉
    if (body.plan_data !== undefined && promoFieldChanged(current.plan_data, body.plan_data)) {
      return NextResponse.json({ success: false, error: PROMO_CHANGED_VIA_PATCH_MESSAGE }, { status: 409 })
    }
    // 「已完成」只能从「已批准」走过去：草稿直接改成已完成 = 没批准过却像批准过
    if (body.status === 'completed' && current.status !== 'approved') {
      return NextResponse.json({ success: false, error: '只有已批准的计划才能标记为已完成。' }, { status: 409 })
    }

    const revertingToDraft = isRevertToDraft(current.status, body.status)
    // 退回草稿 = 撤销批准并清掉未开工待办，不能让客户员工做，只有内部账号可以
    // 标记已完成同样会让该计划下的自动执行失去背书，和退回草稿同一档
    if (revertingToDraft || body.status === 'completed') {
      const approver = await requirePlanApproverAccess(params.id)
      if (!approver.ok) {
        return NextResponse.json({ success: false, error: approver.error, reason: approver.reason }, { status: approver.status })
      }
    }
    const touched = lockedFieldsTouched(body)
    if (!revertingToDraft && touched.length > 0 && (current.status === 'approved' || current.status === 'completed')) {
      return NextResponse.json({
        success: false,
        error: PLAN_CONTENT_LOCKED_MESSAGE,
        locked_fields: touched,
      }, { status: 409 })
    }

    let revoked = 0
    if (revertingToDraft) {
      // 已开工的任务 / 已开始的生产包还在跑：先不许撤回，否则执行物对不上任何获批内容。
      const running = await countRevokeBlockers(params.planId)
      if (running.tasks_in_progress > 0 || running.packages_started > 0) {
        return NextResponse.json({
          success: false,
          error: '这份计划已有进行中的任务或已开始的生产包，处理完（完成或跳过）后才能退回草稿。',
          ...running,
        }, { status: 409 })
      }
      // 退回草稿 = 撤销批准：清掉这份计划还没开始的待办和草稿生产包（有已开工的上面已拒绝）。
      revoked = (await revokePlanTasks(params.planId, params.id)).revoked
      // 退回草稿后，旧批准记录不再算「有效」：回执挪去留底，批准时间清空（再次批准会写新的）
      // 旧的人工核实记录同理：退回草稿后不再参与判定，只留底
      const { approval_receipt: oldReceipt, promo_checks: oldChecks, weekly_reviews: oldReviews, ...restMeta } = current.generation_meta ?? {}
      updates.approved_at = null
      updates.generation_meta = {
        ...restMeta,
        ...(oldReceipt ? { previous_approvals: [...(restMeta.previous_approvals ?? []), oldReceipt].slice(-10) } : {}),
    ...(oldReviews && oldReviews.length > 0 ? { previous_weekly_reviews: [...(restMeta.previous_weekly_reviews ?? []), ...oldReviews].slice(-50) } : {}),
    ...(oldChecks && oldChecks.length > 0 ? { previous_promo_checks: [...(restMeta.previous_promo_checks ?? []), ...oldChecks].slice(-50) } : {}),
      }
    }

    const { data, error } = await supabaseAdmin
      .from('marketing_plans')
      .update(updates)
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .eq('updated_at', current.updated_at) // 读完到写入之间被别处改过（含批准、推广页保存）→ 不覆盖
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      const error = revertingToDraft
        ? '这份计划刚刚在别处被修改了，退回草稿没有完成：还没开始的待办已经清掉，但计划仍是已批准。请刷新页面后再点一次「退回草稿」。'
        : '这份计划刚刚在别处被修改了，这次保存没有生效。请刷新页面后再试。'
      return NextResponse.json({ success: false, error, ...(revertingToDraft ? { revoked_tasks: revoked } : {}) }, { status: 409 })
    }
    return NextResponse.json({ success: true, plan: data, ...(revertingToDraft ? { revoked_tasks: revoked } : {}) })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    // 先确认这份计划属于当前客户，再动它名下的待办 / 生产包（它们只按计划编号过滤）
    const { data: owned, error: ownedErr } = await supabaseAdmin
      .from('marketing_plans')
      .select('id')
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .maybeSingle()
    if (ownedErr) throw ownedErr
    if (!owned) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }

    // 先清除该 Plan 下所有 pending 的执行项（已开工/已完成的保留）
    const { revoked } = await revokePlanTasks(params.planId, params.id)

    // 软删除 — 改 status 而非真删，保留历史
    const { data, error } = await supabaseAdmin
      .from('marketing_plans')
      .update({ status: 'archived' })
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .select('id')
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, archived_id: data.id, revoked_tasks: revoked })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
