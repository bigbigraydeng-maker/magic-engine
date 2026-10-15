/**
 * POST /api/clients/[id]/marketing-plan/[planId]/promo/acknowledge
 * PM 点「按计划继续」：只记一条"这周看过、没意见"，不改计划、不动钱、不派任何东西。
 * 按对账窗口起始日幂等（同一窗口点多次只记一条）。
 */

import { continueButtonVisible } from '@/lib/marketing-plan/promo/labels'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { buildPromoBoard } from '@/lib/marketing-plan/promo/board'
import type { MarketingPlan, WeeklyReviewRecord } from '@/lib/marketing-plan/types'

export async function POST(_req: NextRequest, { params }: { params: { id: string; planId: string } }) {
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  try {
    const { data: plan } = await supabaseAdmin
      .from('marketing_plans').select('*')
      .eq('id', params.planId).eq('client_id', params.id)
      .maybeSingle<MarketingPlan>()
    if (!plan) return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    if (plan.status !== 'approved') {
      return NextResponse.json({ success: false, error: '计划还没批准或已结束，没有"继续"可点' }, { status: 409 })
    }

    const board = await buildPromoBoard(plan)
    if (!board.reconcile) return NextResponse.json({ success: false, error: '这份计划没有推广计划结构' }, { status: 400 })
    // 与页面按钮同一条件：看不清 / 落后 / 超标的周不能留下"没意见"
    if (!continueButtonVisible({ ...board, reviewed_this_window: false })) {
      return NextResponse.json({ success: false, error: '本周对账有异常或看不清，或到期阶段的检查清单还没过关，不能点"按计划继续"，请先处理。' }, { status: 409 })
    }
    const weekStart = board.reconcile.window.start

    const existing = plan.generation_meta?.weekly_reviews ?? []
    if (existing.some(r => r.week_start === weekStart)) {
      return NextResponse.json({ success: true, already_recorded: true, week_start: weekStart })
    }
    const record: WeeklyReviewRecord = { week_start: weekStart, by: access.user.email ?? null, at: new Date().toISOString() }
    const { data, error } = await supabaseAdmin
      .from('marketing_plans')
      .update({ generation_meta: { ...(plan.generation_meta ?? {}), weekly_reviews: [...existing, record] } })
      .eq('id', params.planId).eq('client_id', params.id)
      .eq('updated_at', plan.updated_at) // 读完到写入之间被别处改过 → 不覆盖
      .select('id').maybeSingle()
    if (error) throw error
    if (!data) {
      return NextResponse.json({ success: false, error: '这份计划刚刚在别处被改过，这次确认没有记录。请刷新页面后再点一次。' }, { status: 409 })
    }
    return NextResponse.json({ success: true, record })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
