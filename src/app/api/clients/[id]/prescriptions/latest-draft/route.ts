/**
 * GET /api/clients/[id]/prescriptions/latest-draft[?goal_id=...]
 *
 * 返回该客户最近一份非废弃的处方（status IN draft/generating/failed/approved）。
 *
 * DAPE Week 2 W4: 加 ?goal_id 可选 filter — 用于版本化场景下定位"该 Goal 下最新版".
 *  - 缺 goal_id: 兼容旧逻辑 (按 client_id, latest by created_at)
 *  - 有 goal_id: 该 Goal 下最新版 (按 version DESC fallback created_at)
 *
 * 前端 mount 时用来恢复状态：
 *   - draft/generating/failed → 可编辑的审阅态
 *   - approved → 只读态（前端会切到"已批准"UI）
 *
 * 404 若没有任何处方。
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { Prescription } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // DAPE W4: 可选 goal_id filter
  const goalId = req.nextUrl.searchParams.get('goal_id')

  try {
    let query = supabaseAdmin
      .from('prescriptions')
      .select('*')
      .eq('client_id', clientId)
      .in('status', ['draft', 'generating', 'failed', 'approved'])

    if (goalId) {
      // 该 Goal 下最新版本: version DESC, fallback created_at
      query = query.eq('goal_id', goalId)
        .order('version', { ascending: false })
        .order('created_at', { ascending: false })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    const { data, error } = await query.limit(1).maybeSingle<Prescription>()

    if (error) {
      console.error('[prescriptions/latest-draft] db error', error)
      return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'No draft prescription' }, { status: 404 })
    }

    return NextResponse.json({ success: true, prescription: data }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (err: unknown) {
    console.error('[prescriptions/latest-draft] error', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}
