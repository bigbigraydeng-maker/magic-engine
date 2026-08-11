import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// POST /api/clients/[id]/campaign/[campaignId]/archive
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; campaignId: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const { id: clientId, campaignId } = params

  const { data, error } = await supabaseAdmin
    .from('campaign_briefs')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('client_id', clientId)
    .select('id, title, status')
    .single()

  if (error || !data) {
    return NextResponse.json({ success: false, error: error?.message ?? 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, campaign: data })
}
