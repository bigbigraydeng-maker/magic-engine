import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/clients/[id]/campaign — list campaigns (default: active only)
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const clientId = params.id
  const status = req.nextUrl.searchParams.get('status') ?? 'active'

  let query = supabaseAdmin
    .from('campaign_briefs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, campaigns: data ?? [] })
}

// POST /api/clients/[id]/campaign — create new campaign
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const clientId = params.id

  try {
    const body = await req.json()
    const { title, description, source_urls, source_file_urls, valid_from, valid_until } = body

    if (!title?.trim()) {
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('campaign_briefs')
      .insert({
        client_id:        clientId,
        title:            title.trim(),
        description:      description ?? null,
        source_urls:      source_urls ?? [],
        source_file_urls: source_file_urls ?? [],
        valid_from:       valid_from ?? null,
        valid_until:      valid_until ?? null,
        status:           'active',
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, campaign: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
