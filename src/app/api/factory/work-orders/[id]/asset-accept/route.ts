// POST /api/factory/work-orders/[id]/asset-accept — 把「素材（asset_only）」工单验收入库（in_review → archived）。
// 归档前先把成片传进该客户广告账户视频库，并以待批准写入素材池。上传失败则不归档。
// 只给内部员工（全站管理员）；限定单个客户的管理员不能用。这不是发布授权，也不是素材批准。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminScope } from '@/lib/auth/require-admin'
import { applyAssetAccept } from '@/lib/factory/review-apply'
import { admitAssetBeforeAccept, type AdmitOutcome } from '@/lib/ads-strategy/admit-finished-asset-run'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function poolReceipt(admitted: AdmitOutcome & { ok: true }) {
  if (admitted.action !== 'pooled') return { action: admitted.action }
  return { action: admitted.action, status: admitted.status, video_id: admitted.videoId }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  if (admin.scope.kind !== 'global') {
    return NextResponse.json({ error: 'Forbidden — only internal staff can accept material' }, { status: 403 })
  }
  const { id } = await params
  const admitted = await admitAssetBeforeAccept(supabaseAdmin, id)
  if (!admitted.ok) return NextResponse.json({ error: admitted.error }, { status: admitted.status })
  const reviewer = admin.user.email ?? 'admin'
  const result = await applyAssetAccept(supabaseAdmin, id, reviewer)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, ...result.data, pool: poolReceipt(admitted) })
}
