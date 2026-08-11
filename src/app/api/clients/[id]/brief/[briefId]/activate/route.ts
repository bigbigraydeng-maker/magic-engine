import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/clients/[id]/brief/[briefId]/activate
 *
 * Atomically switches the active brief for a client:
 * 1. Archives all other briefs for this client
 * 2. Sets the target brief to status='active'
 *
 * The partial unique index on master_briefs enforces only one active per client.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; briefId: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    // Verify the brief belongs to this client
    const { data: target, error: fetchError } = await supabaseAdmin
      .from('master_briefs')
      .select('id, status')
      .eq('id', params.briefId)
      .eq('client_id', params.id)
      .single()

    if (fetchError || !target) {
      return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
    }

    if (target.status === 'active') {
      return NextResponse.json({ message: 'Already active' })
    }

    // Archive all other briefs for this client
    await supabaseAdmin
      .from('master_briefs')
      .update({ status: 'archived', is_active: false, updated_at: new Date().toISOString() })
      .eq('client_id', params.id)
      .neq('id', params.briefId)

    // Activate the target brief
    const { data: activated, error: activateError } = await supabaseAdmin
      .from('master_briefs')
      .update({ status: 'active', is_active: true, updated_at: new Date().toISOString() })
      .eq('id', params.briefId)
      .select()
      .single()

    if (activateError) throw activateError

    return NextResponse.json({ success: true, brief: activated })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
