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
import type { MarketingPlanData, MarketingPlanStatus } from '@/lib/marketing-plan/types'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  PLAN_CONTENT_LOCKED_MESSAGE,
  isRevertToDraft,
  lockedFieldsTouched,
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
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const body = await req.json().catch(() => ({})) as PatchBody

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
      updates.status = body.status
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 })
    }

    // 已批准 / 已完成的计划内容被锁住：批准的是 A，就不能悄悄改成 B 继续跑。
    // 要改内容就先退回草稿（status: 'draft'），退回时清掉还没开始的待办。
    const { data: current, error: currentErr } = await supabaseAdmin
      .from('marketing_plans')
      .select('status')
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .maybeSingle<{ status: MarketingPlanStatus }>()
    if (currentErr) throw currentErr
    if (!current) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }

    const revertingToDraft = isRevertToDraft(current.status, body.status)
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
      revoked = (await revokePlanTasks(params.planId)).revoked
    }

    const { data, error } = await supabaseAdmin
      .from('marketing_plans')
      .update(updates)
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .select('*')
      .single()

    if (error) throw error
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
  const access = await requirePaidClientAccess(params.id)
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
    const { revoked } = await revokePlanTasks(params.planId)

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
