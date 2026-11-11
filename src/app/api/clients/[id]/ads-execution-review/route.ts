/**
 * GET /api/clients/[id]/ads-execution-review
 *
 * Read-only post-execution review for budget and pause confirmation cards.
 */
import { NextResponse } from 'next/server'

import { loadAdsExecutionReviewPanel } from '@/lib/ads/ads-execution-review-load'
import { EXECUTION_REVIEW_DEFAULT_LIMIT } from '@/lib/ads/ads-execution-review-panel'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { isUuid } from '@/lib/validation-utils'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!isUuid(params.id)) {
    return NextResponse.json({ success: false, error: '这个地址不对。' }, { status: 400 })
  }

  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    const message = access.status === 401 ? '请先登录。' : '你不能看这位客户。'
    return NextResponse.json({ success: false, error: message }, { status: access.status })
  }

  const url = new URL(req.url)
  const limitRaw = url.searchParams.get('limit')
  const limitParsed = limitRaw !== null ? Number(limitRaw) : EXECUTION_REVIEW_DEFAULT_LIMIT
  const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : EXECUTION_REVIEW_DEFAULT_LIMIT

  try {
    const panel = await loadAdsExecutionReviewPanel(supabaseAdmin, {
      clientId: params.id,
      limit,
    })
    return NextResponse.json({ success: true, panel })
  } catch (error: unknown) {
    console.error('[ads-execution-review] failed', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ success: false, error: '改完后的成绩读取失败，请刷新。' }, { status: 500 })
  }
}
