/**
 * POST /api/clients/[id]/marketing-plan/[planId]/promo/acknowledge
 * PM 点「按计划继续」：只记一条"这周看过、没意见"，不改计划、不动钱、不派任何东西。
 * 按对账窗口起始日幂等（同一窗口点多次只记一条）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { buildPromoBoard } from '@/lib/marketing-plan/promo/board'
import type { MarketingPlan, WeeklyReviewRecord } from '@/lib/marketing-plan/types'

export async function POST(_req: NextRequest, { params }: { params: { id: string; planId: string } }) {
  const access = await requirePaidClientAccess(params.id)
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
    const weekStart = board.reconcile.window.start

    const existing = plan.generation_meta?.weekly_reviews ?? []
    if (existing.some(r => r.week_start === weekStart)) {
      return NextResponse.json({ success: true, already_recorded: true, week_start: weekStart })
    }
    const record: WeeklyReviewRecord = { week_start: weekStart, by: access.user.email ?? null, at: new Date().toISOString() }
    const { error } = await supabaseAdmin
      .from('marketing_plans')
      .update({ generation_meta: { ...(plan.generation_meta ?? {}), weekly_reviews: [...existing, record] } })
      .eq('id', params.planId).eq('client_id', params.id)
    if (error) throw error
    return NextResponse.json({ success: true, record })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
