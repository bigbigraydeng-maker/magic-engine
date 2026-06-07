/**
 * DAPE Week 2 W4 — GET /api/goals/[goalId]/prescriptions
 *
 * 列出 Goal 下所有处方版本 (v1/v2/v3...).
 * 用于:
 *   - 处方页顶部版本切换 chips (修 BUG-FMT-F21)
 *   - Goal 详情页 "查看处方历史" 链接
 *   - 修订流程: UI 知道当前 active 是哪一版
 *
 * 排序: version DESC (最新版排第一).
 * 包含 superseded / rejected 状态 (历史版本可看). 不返回 generating / failed (中间态).
 *
 * Security: Bearer token (INTERNAL_API_KEY) via requireGoalAccess
 * Spec §2.3.3 + §5 Week 2
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'
import type { Prescription } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('prescriptions')
    .select('id, status, version, supersedes_id, supplements_id, created_at, approved_at, intake, self_grade')
    .eq('goal_id', params.goalId)
    .in('status', ['draft', 'approved', 'rejected', 'superseded'])
    .order('version', { ascending: false })

  if (error) {
    console.error('[goals/prescriptions GET] error', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // self_grade 不在 Prescription 类型里, 用宽松类型
  type PrescriptionVersionRow =
    Pick<Prescription, 'id' | 'status' | 'version' | 'supersedes_id' | 'supplements_id' | 'created_at' | 'approved_at' | 'intake'>
    & { self_grade?: unknown }

  // 找当前 active 版 (status=approved 且未被任何 supersedes 链路指向)
  const list = (data ?? []) as PrescriptionVersionRow[]

  const supersededIds = new Set(list.filter(p => p.supersedes_id != null).map(p => p.supersedes_id))
  const activeApproved = list.find(p => p.status === 'approved' && !supersededIds.has(p.id))

  return NextResponse.json({
    success: true,
    prescriptions: list,
    active_prescription_id: activeApproved?.id ?? null,
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
