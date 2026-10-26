// POST /api/factory/work-orders/[id]/asset-accept — 把「素材（asset_only）」工单验收入库（in_review → archived）。
// 只给内部员工（全站管理员）；限定单个客户的管理员不能用。这不是发布授权。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminScope } from '@/lib/auth/require-admin'
import { applyAssetAccept } from '@/lib/factory/review-apply'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  if (admin.scope.kind !== 'global') {
    return NextResponse.json({ error: 'Forbidden — only internal staff can accept material' }, { status: 403 })
  }
  const { id } = await params
  const reviewer = admin.user.email ?? 'admin'
  const result = await applyAssetAccept(supabaseAdmin, id, reviewer)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, ...result.data })
}
