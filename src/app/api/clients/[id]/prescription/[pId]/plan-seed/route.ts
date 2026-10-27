/**
 * GET /api/clients/[id]/prescription/[pId]/plan-seed
 * 现算这份处方的计划草稿建议（plan seed）。
 *
 * 这是只读接口，现算不落库：只读处方内容、只算建议，不写任何表。
 * 批准处方不等于批准花钱：这里只给出建议，真正花钱仍要走后续的保存与审批流程。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import type { PrescriptionContent } from '@/types/diagnostic'
import { collectAdPlays } from '@/lib/ads-strategy/plan-seed/attach'
import { buildPlanSeed } from '@/lib/ads-strategy/plan-seed/build'
import { loadGoalPeriod, productionDeps } from '@/lib/ads-strategy/plan-seed/deps'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string; pId: string } }) {
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const { data: row, error } = await supabaseAdmin
    .from('prescriptions')
    .select('id, client_id, goal_id, content')
    .eq('id', params.pId)
    .eq('client_id', params.id)
    .maybeSingle<{ id: string; client_id: string; goal_id: string | null; content: PrescriptionContent | null }>()

  if (error) {
    return NextResponse.json({ success: false, error: '读取处方失败' }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json({ success: false, error: '处方不存在' }, { status: 404 })
  }

  const content = row.content
  if (content === null) {
    return NextResponse.json({ success: true, seed: null, reason: '这份处方没有填广告打法（ad_plays）' })
  }

  const plays = collectAdPlays(content)
  if (plays.length === 0) {
    return NextResponse.json({ success: true, seed: null, reason: '这份处方没有填广告打法（ad_plays）' })
  }

  try {
    const period = await loadGoalPeriod(row.goal_id)
    const seed = await buildPlanSeed({ clientId: params.id, plays, period }, productionDeps())
    return NextResponse.json({ success: true, seed, computed_at: new Date().toISOString() })
  } catch (err) {
    console.error('[plan-seed] compute failed', err instanceof Error ? err.message : '未知错误')
    return NextResponse.json({ success: false, error: '算不出计划草稿建议，请稍后再试' }, { status: 500 })
  }
}
