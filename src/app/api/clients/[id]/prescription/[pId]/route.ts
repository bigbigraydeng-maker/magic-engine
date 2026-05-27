/**
 * GET  /api/clients/[id]/prescription/[pId]
 *   → Full prescription detail (intake + content + status)
 *
 * PATCH /api/clients/[id]/prescription/[pId]
 *   Body: { status: 'approved'|'rejected', approved_by?: string, rejection_note?: string }
 *   - 'approved' → save approval + synchronously generate execution_items
 *   - 'rejected'  → record rejection note
 *   - Already-approved prescription → 409 Conflict
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.16
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { generateExecutionItems } from '@/lib/diagnostic/execution-generator'
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
  const access = await requireDashboardClientAccess(clientId)
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
  approved_by?: string
  rejection_note?: string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
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

    // Fetch current prescription（含 supersedes_id — 修订处方批准时要归档原处方）
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('prescriptions')
      .select('id, status, client_id, supersedes_id')
      .eq('id', pId)
      .eq('client_id', clientId)
      .single<Pick<Prescription, 'id' | 'status' | 'client_id' | 'supersedes_id'>>()

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

    // ── 批准：先生成 execution_items，成功后才标记 approved ──────────────
    // （顺序很重要：若生成失败，status 保持 draft，不会卡在"已批准但无执行项"）
    if (body.status === 'approved') {
      try {
        await generateExecutionItems(supabaseAdmin, pId, clientId)
      } catch (genErr: unknown) {
        const msg = genErr instanceof Error ? genErr.message : String(genErr)
        console.error('[prescription PATCH] generateExecutionItems failed:', msg, genErr)
        return NextResponse.json(
          { success: false, error: `生成执行计划失败：${msg}` },
          { status: 500 },
        )
      }

      // 修订处方批准 → 把被修订的原处方置 superseded（归档）
      if (current.supersedes_id) {
        const { error: supErr } = await supabaseAdmin
          .from('prescriptions')
          .update({ status: 'superseded' })
          .eq('id', current.supersedes_id)
          .eq('client_id', clientId)
        if (supErr) {
          console.error('[prescription PATCH] supersede prior failed:', supErr)
          // 非致命 — 新处方已批准，原处方归档失败只记日志
        }
      }
    }

    // Build update payload
    const patch: Record<string, unknown> = { status: body.status }
    if (body.status === 'approved') {
      patch.approved_at = new Date().toISOString()
      if (body.approved_by) patch.approved_by = body.approved_by
    }
    if (body.status === 'rejected' && body.rejection_note) {
      patch.rejection_note = body.rejection_note
    }

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
