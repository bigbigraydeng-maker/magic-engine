/**
 * GET  /api/clients/[id]/marketing-plan?status=<status>
 * POST /api/clients/[id]/marketing-plan/generate   (see ./generate/route.ts)
 *
 * 列出客户的 Marketing Plan。可按 status 过滤（默认所有）。
 * 返回按 created_at desc 排序，最多 20 条。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { MarketingPlan, MarketingPlanStatus } from '@/lib/marketing-plan/types'

const VALID_STATUSES: MarketingPlanStatus[] = ['draft', 'approved', 'completed', 'archived']

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    return NextResponse.json({
      success: true,
      plans: (data ?? []) as MarketingPlan[],
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[marketing-plan GET] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
