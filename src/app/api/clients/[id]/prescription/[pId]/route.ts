/**
 * GET  /api/clients/[id]/prescription/[pId]
 *   → Full prescription detail (intake + content + status)
 *
 * PATCH /api/clients/[id]/prescription/[pId]
 *   Body: { status: 'approved'|'rejected', rejection_note?: string }
 *   - 'approved' → save approval (含批准人，取自会话) + synchronously generate execution_items
 *   - 'rejected'  → record rejection note
 *   - Already-approved prescription → 409 Conflict
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.16
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { landPrescription } from '@/lib/diagnostic/prescription-landing'
import { buildPrescriptionDecisionPatch } from '@/lib/diagnostic/prescription-patch'
import type { Prescription, PrescriptionStatus } from '@/types/diagnostic'

// 关键：禁用 Next.js 路由缓存，否则华佗异步 polling 拿不到刚写入的 content。
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ---------------------------------------------------------------------------
// GET — fetch prescription
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { pId } = params

    const { data, error } = await supabaseAdmin
      .from('prescriptions')
      .select('*')
      .eq('id', pId)
      .eq('client_id', clientId)
      .single<Prescription>()

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Prescription not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, prescription: data }, {
      headers: {
        // 双重保险：浏览器也不要缓存
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (err: unknown) {
    console.error('[prescription GET] Error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH — approve or reject
// ---------------------------------------------------------------------------

type PatchBody = {
  status: 'approved' | 'rejected'
  rejection_note?: string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { pId } = params
    const body = (await req.json()) as Partial<PatchBody>

    if (!body.status || !['approved', 'rejected'].includes(body.status)) {
      return NextResponse.json(
        { success: false, error: 'status must be "approved" or "rejected"' },
        { status: 400 },
      )
    }

    // Fetch current prescription（含 supersedes_id 修订归档 + DAPE W4 goal_id/version/content for Initiative 派生）
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('prescriptions')
      .select('id, status, client_id, supersedes_id, goal_id, version, content')
      .eq('id', pId)
      .eq('client_id', clientId)
      .single<Pick<Prescription, 'id' | 'status' | 'client_id' | 'supersedes_id' | 'goal_id' | 'version' | 'content'>>()

    if (fetchError || !current) {
      return NextResponse.json({ success: false, error: 'Prescription not found' }, { status: 404 })
    }

    // Already-approved prescriptions cannot be modified (409 Conflict)
    if (current.status === 'approved') {
      return NextResponse.json(
        { success: false, error: 'Prescription is already approved and cannot be modified' },
        { status: 409 },
      )
    }

    // ── 批准 = 落地 ──
    // 派生 Initiative → 生成执行项 → 归档旧版 → 标 approved，整套在
    // lib/diagnostic/prescription-landing.ts 里，跟处方周更共用同一段代码。
    // （顺序很重要：若执行项生成失败，status 保持 draft，
    //   不会卡在"已批准但看板上没动作"这种从界面完全看不出来的状态。）
    if (body.status === 'approved') {
      try {
        // 批准人取自登录会话，不认前端传的值（前端说自己是谁不算数）
        const landed = await landPrescription(supabaseAdmin, current, access.user.email)
        console.info('[prescription PATCH] landed:', {
          prescriptionId: pId,
          goalId: current.goal_id,
          initiatives: landed.initiativesInserted,
          executionItems: landed.executionItems,
        })
        for (const note of landed.notes) console.info('  ', note)
      } catch (landErr: unknown) {
        const msg = landErr instanceof Error ? landErr.message : String(landErr)
        console.error('[prescription PATCH] landPrescription failed:', msg, landErr)
        return NextResponse.json(
          { success: false, error: `生成执行计划失败：${msg}` },
          { status: 500 },
        )
      }

      // 落地时已经把 status/approved_at 写好了，直接读回来返回给调用方
      const { data: landedRow, error: readErr } = await supabaseAdmin
        .from('prescriptions')
        .select('*')
        .eq('id', pId)
        .eq('client_id', clientId)
        .single<Prescription>()
      if (readErr || !landedRow) {
        console.error('[prescription PATCH] read-back after landing failed:', readErr)
        return NextResponse.json({ success: false, error: 'Failed to update prescription' }, { status: 500 })
      }
      return NextResponse.json({ success: true, prescription: landedRow })
    }

    // Build update payload（走到这儿只剩 rejected）
    // 只允许写真实存在的列 —— 见 prescription-patch.ts 的列白名单
    const patch = buildPrescriptionDecisionPatch({
      status: body.status,
      rejection_note: body.rejection_note,
    })

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('prescriptions')
      .update(patch)
      .eq('id', pId)
      .eq('client_id', clientId)
      .select('*')
      .single<Prescription>()

    if (updateError || !updated) {
      console.error('[prescription PATCH] Update error:', updateError)
      return NextResponse.json({ success: false, error: 'Failed to update prescription' }, { status: 500 })
    }

    return NextResponse.json({ success: true, prescription: updated })
  } catch (err: unknown) {
    console.error('[prescription PATCH] Error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
