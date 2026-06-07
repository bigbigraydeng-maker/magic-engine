/**
 * 三代理复盘引擎 API（P8.10.S6）
 *
 * GET  /api/clients/[id]/review
 *   → 返回该客户的复盘报告历史（最新在前）
 *
 * POST /api/clients/[id]/review
 *   → 跑一次新的复盘，产出结构化复盘报告并持久化
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { runProjectReview } from '@/lib/review/agent'
import type { ProjectReview } from '@/lib/review/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ─── GET — 复盘历史 ───────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {

    const { data, error } = await supabaseAdmin
      .from('project_reviews')
      .select('id, client_id, status, summary, content, meta, error_message, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[review GET] db error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load reviews' }, { status: 500 })
    }

    return NextResponse.json(
      { success: true, reviews: (data ?? []) as ProjectReview[] },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err: unknown) {
    console.error('[review GET] unexpected:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ─── POST — 跑一次复盘 ────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {

    let productionPackageId: string | undefined
    try {
      const body = (await req.json()) as { production_package_id?: string }
      productionPackageId = body.production_package_id
    } catch {
      // body is optional
    }

    const result = await runProjectReview(supabaseAdmin, clientId, productionPackageId)

    return NextResponse.json({
      success: true,
      content: result.content,
      summary: result.summary,
      meta: result.meta,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[review POST] error:', msg, err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
