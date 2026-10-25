/**
 * GET  /api/clients/[id]/marketing-plan?status=<status>
 * POST /api/clients/[id]/marketing-plan   新建一条空白草稿（见本文件 POST）
 * POST /api/clients/[id]/marketing-plan/generate   (see ./generate/route.ts)
 *
 * 列出客户的 Marketing Plan。可按 status 过滤（默认所有）。
 * 返回按 created_at desc 排序，最多 20 条。
 *
 * POST 只插入一行草稿，挂到请求里的 goal_id。不生成内容、不批准、不派待办，
 * 也不改已有计划。单次同步写入，没有外发，不上工作流。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { MarketingPlan, MarketingPlanStatus } from '@/lib/marketing-plan/types'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createBlankDraftPlan } from '@/lib/marketing-plan/blank-draft-create'
import { loadLatestClientPrescription } from '@/lib/marketing-plan/promo/goal-prescription'

const VALID_STATUSES: MarketingPlanStatus[] = ['draft', 'approved', 'completed', 'archived']

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const clientId = params.id
  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status')
  const status = statusParam && VALID_STATUSES.includes(statusParam as MarketingPlanStatus)
    ? (statusParam as MarketingPlanStatus)
    : null

  try {
    let query = supabaseAdmin
      .from('marketing_plans')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error
    const prescription = await loadLatestClientPrescription(clientId).catch((err: unknown) => {
      console.warn('[marketing-plan GET] 处方没读到', err instanceof Error ? err.message : err)
      return null
    })

    return NextResponse.json({
      success: true,
      plans: (data ?? []) as MarketingPlan[],
      prescription,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[marketing-plan GET] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }
  const goalId = await readGoalId(req)
  if (!goalId.ok) {
    return NextResponse.json({ success: false, error: goalId.error }, { status: 400 })
  }
  try {
    const result = await createBlankDraftPlan(params.id, goalId.goalId)
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true, plan: result.plan })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[marketing-plan POST blank draft] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

async function readGoalId(
  req: NextRequest,
): Promise<{ ok: true; goalId: string } | { ok: false; error: string }> {
  const body = await req.json().catch(() => null) as { goal_id?: unknown } | null
  const goalId = typeof body?.goal_id === 'string' ? body.goal_id.trim() : ''
  if (!goalId) return { ok: false, error: '请选择一个目标' }
  return { ok: true, goalId }
}
