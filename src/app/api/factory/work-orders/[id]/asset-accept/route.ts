// POST /api/factory/work-orders/[id]/asset-accept — 内部员工重跑仅素材三关验收。
// 过了才归档并入池（已批准，带上这次上传的视频编号）。没过或上传失败则不归档。
// 只给内部员工（全站管理员）；限定单个客户的管理员不能用。这不是发布授权。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminScope } from '@/lib/auth/require-admin'
import { runAssetDualReviewById, type DualReviewReceipt } from '@/lib/factory/asset-dual-review-run'
import { supabaseDualReviewIo } from '@/lib/factory/asset-dual-review-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function errorStatus(receipt: DualReviewReceipt): number {
  if (receipt.status === 'upload_failed') return 502
  if (receipt.status === 'unreadable') return 503
  if (receipt.reason === '工单不存在') return 404
  return 409
}

function errorText(receipt: DualReviewReceipt): string {
  if (receipt.reason) return receipt.reason
  if (receipt.status === 'skipped') return '只有仅素材工单可以这样入库'
  if (receipt.status === 'recorded') return '三关还没过，成片没有进素材池'
  if (receipt.status === 'conflict') return '工单刚被别处改过，请再试一次'
  return '成片没有进素材池'
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  if (admin.scope.kind !== 'global') {
    return NextResponse.json({ error: 'Forbidden — only internal staff can accept material' }, { status: 403 })
  }
  const { id } = await params
  const receipt = await runAssetDualReviewById(supabaseDualReviewIo(supabaseAdmin), id)
  if (receipt.status !== 'pooled') {
    return NextResponse.json({ error: errorText(receipt) }, { status: errorStatus(receipt) })
  }
  return NextResponse.json({
    ok: true,
    status: 'archived',
    pool: {
      action: 'pooled',
      status: 'approved',
      ...(receipt.videoId ? { video_id: receipt.videoId } : {}),
    },
  })
}
