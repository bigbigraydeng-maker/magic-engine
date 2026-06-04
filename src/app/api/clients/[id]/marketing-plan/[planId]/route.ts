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
import { revokePlanTasks } from '@/lib/marketing-plan/task-dispatcher'
import type { MarketingPlanData, MarketingPlanStatus } from '@/lib/marketing-plan/types'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

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

    const { data, error } = await supabaseAdmin
      .from('marketing_plans')
      .update(updates)
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, plan: data })
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
