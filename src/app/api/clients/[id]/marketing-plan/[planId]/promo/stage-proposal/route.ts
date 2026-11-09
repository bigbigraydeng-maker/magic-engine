/**
 * POST 生成一份放量草稿。不改正在跑的计划，不批准，不写广告后台。
 * 证据不够就拒绝。已经有一份对应草稿就返回那一份，不重复建。
 */

import { NextRequest, NextResponse } from 'next/server'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { buildPromoBoard } from '@/lib/marketing-plan/promo/board'
import { createStageProposal } from '@/lib/marketing-plan/promo/stage-proposal'
import type { MarketingPlan } from '@/lib/marketing-plan/types'

export async function POST(req: NextRequest, { params }: { params: { id: string; planId: string } }) {
  const denied = await rejectAgentAdsBearer(req, { clientId: params.id, action: 'outside_allowlist' })
  if (denied) return denied
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  const { data: plan } = await supabaseAdmin.from('marketing_plans').select('*')
    .eq('id', params.planId).eq('client_id', params.id).maybeSingle<MarketingPlan>()
  if (!plan) return NextResponse.json({ success: false, error: '找不到这份计划' }, { status: 404 })
  const board = await buildPromoBoard(plan)
  if (!board.today) {
    return NextResponse.json({ success: false, error: '不知道今天是客户的哪一天，没有新建草稿。' }, { status: 409 })
  }
  const result = await createStageProposal(supabaseAdmin, params.id, plan, board.today)
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, plan_id: result.planId, already: result.already })
}
