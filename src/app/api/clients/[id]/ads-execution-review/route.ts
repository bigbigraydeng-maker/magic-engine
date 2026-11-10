/**
 * GET /api/clients/[id]/ads-execution-review
 *
 * Read-only post-execution review for budget and pause confirmation cards.
 */
import { NextResponse } from 'next/server'

import { EXECUTION_REVIEW_DEFAULT_LIMIT } from '@/lib/ads-execution-review/panel'
import { loadAdsExecutionReviewPanel } from '@/lib/ads-execution-review/load'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { isUuid } from '@/lib/validation-utils'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function refused(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status })
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!isUuid(params.id)) return refused(400, '这个地址不对。')
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return refused(access.status, access.status === 401 ? '请先登录。' : '你不能看这位客户的改后结论。')
  }

  const url = new URL(req.url)
  const limitRaw = url.searchParams.get('limit')
  const limitParsed = limitRaw !== null ? Number(limitRaw) : EXECUTION_REVIEW_DEFAULT_LIMIT
  const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.min(limitParsed, 30) : EXECUTION_REVIEW_DEFAULT_LIMIT

  try {
    const panel = await loadAdsExecutionReviewPanel(supabaseAdmin, {
      clientId: params.id,
      limit,
      now: new Date(),
    })
    return NextResponse.json({ success: true, panel })
  } catch (error: unknown) {
    console.error('[ads-execution-review] failed', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ success: false, error: '读取失败，请刷新后再看。' }, { status: 500 })
  }
}
