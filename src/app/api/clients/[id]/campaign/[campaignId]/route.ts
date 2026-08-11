import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

type RouteContext = { params: { id: string; campaignId: string } }

// GET /api/clients/[id]/campaign/[campaignId]
export async function GET(_req: NextRequest, { params }: RouteContext) {
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
    .select('*')
    .eq('id', campaignId)
    .eq('client_id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, campaign: data })
}

// DELETE /api/clients/[id]/campaign/[campaignId]
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const { id: clientId, campaignId } = params

  try {
    const { error } = await supabaseAdmin
      .from('campaign_briefs')
      .delete()
      .eq('id', campaignId)
      .eq('client_id', clientId)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// PATCH /api/clients/[id]/campaign/[campaignId]
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const { id: clientId, campaignId } = params

  try {
    const body = await req.json()

    // Guard: never allow status change via PATCH (use /archive instead)
    const { status: _dropped, client_id: _dropped2, id: _dropped3, ...fields } = body

    const { data, error } = await supabaseAdmin
      .from('campaign_briefs')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('client_id', clientId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, campaign: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
