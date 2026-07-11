// P21.J M2 — POST /api/factory/work-orders/[id]/revive(spec §6.1 dead_letter 复活)
// dead_letter 工单一键复活回 queued:清 claim 痕迹 + attempt_count 归零(人工判断值得重试),
// 记 reclaim_count+1 + revived_by 留痕。仅 admin(guardAdmin)。非 dead_letter 状态拒。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdmin()
  if (guard) return guard
  const admin = await requireAdmin()
  const reviver = admin.ok ? (admin.user.email ?? 'admin') : 'admin'

  const { id } = await params

  const { data: wo, error: loadErr } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, status, reclaim_count, reject_reason')
    .eq('id', id)
    .maybeSingle()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!wo) return NextResponse.json({ error: 'work order not found' }, { status: 404 })
  if (wo.status !== 'dead_letter') {
    return NextResponse.json(
      { error: `only dead_letter orders can be revived (status=${wo.status})` },
      { status: 409 },
    )
  }

  const { data: updated, error: upErr } = await supabaseAdmin
    .from('content_work_orders')
    .update({
      status: 'queued',
      attempt_count: 0, // 人工判断值得重试 → attempt 归零,给满额重试次数
      reclaim_count: Number(wo.reclaim_count) + 1,
      claimed_by: null,
      claimed_at: null,
      heartbeat_at: null,
      reject_reason: null,
      review_ref: { revived_by: reviver, revived_at: new Date().toISOString(), prev_reject: wo.reject_reason },
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'dead_letter') // 二次条件防并发双复活
    .select('id')
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'work order no longer in dead_letter' }, { status: 409 })
  }

  console.warn(`[factory] work order ${id} revived to queued by ${reviver}`)
  return NextResponse.json({ ok: true, status: 'queued' })
}
