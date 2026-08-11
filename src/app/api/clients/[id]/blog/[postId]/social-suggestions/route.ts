import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import {
  GenerateSocialSuggestionsError,
  generateSocialSuggestions,
} from '@/lib/blog/generate-social-suggestions'

/**
 * POST /api/clients/[id]/blog/[postId]/social-suggestions
 * Generates 3 social media content ideas (Facebook / Instagram / LinkedIn)
 * from an approved blog post and writes them to content_strategy_items.
 *
 * Thin wrapper around the shared `generateSocialSuggestions` lib.  The PATCH
 * route on /blog/[postId] calls the lib directly (see QA-清理-1).  This HTTP
 * endpoint remains for explicit server-to-server invocation only.
 *
 * Security: requires Bearer INTERNAL_API_KEY.
 * Reference: ROADMAP.md P8.2.4, QA-清理-1
 */

export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, postId } = params
    const result = await generateSocialSuggestions(supabaseAdmin, clientId, postId)
    return NextResponse.json({ success: true, items: result.items })
  } catch (err: unknown) {
    if (err instanceof GenerateSocialSuggestionsError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status })
    }
    console.error('[social-suggestions POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
