import { requireDashboardClientAccess } from '@/lib/auth/client-access'
/**
 * GET /api/clients/[id]/seo-meta-log
 *
 * Returns the SEO meta optimisation history for a client.
 * Populated by the oztop-seo-optimizer cron loop.
 *
 * Query params:
 *   ?limit=N   (default 50)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const clientId = params.id
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 200)

  const { data, error } = await supabaseAdmin
    .from('seo_meta_log')
    .select('id, page_slug, page_url, keyword, old_title, old_desc, new_title, new_desc, wp_updated, optimised_at')
    .eq('client_id', clientId)
    .order('optimised_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, logs: data ?? [] })
}
