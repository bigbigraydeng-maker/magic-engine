/**
 * Ads D3 自动暂停——待批准列表。
 *
 * GET → 这个客户当前等人点头的暂停建议。真相是 Kernel 的 `action_runs`
 * （`status='pending_approval'`），账表 `flywheel_actions` 只补展示字段 ——
 * 读法见 `src/lib/ads-strategy/auto-pause-pending.ts`。批准/驳回走同目录下
 * `[runId]/decision/route.ts`，提交时必须原样带回这里给的 `expectedDecisionId`。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { listPendingAdsAutoPauseForClient } from '@/lib/ads-strategy/auto-pause-pending'

export const dynamic = 'force-dynamic'

interface RouteParams { params: { id: string } }

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    // 🔴 客户过滤钉在数据库侧：只用鉴权过的 params.id
    const { items, hasMore } = await listPendingAdsAutoPauseForClient(supabaseAdmin, params.id)
    return NextResponse.json({ items, hasMore })
  } catch (e) {
    // 原始错误只进日志 —— 不把库内部细节吐给页面
    console.error('[ad-health/auto-pause] 读取待批准列表失败:', e)
    return NextResponse.json({ error: '读取待批准列表失败，稍后刷新再试' }, { status: 500 })
  }
}
