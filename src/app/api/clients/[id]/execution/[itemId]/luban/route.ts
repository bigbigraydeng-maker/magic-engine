/**
 * 鲁班对话 API（P8.10.S4.2）
 *
 * GET  /api/clients/[id]/execution/[itemId]/luban
 *   → 加载该执行项的鲁班对话历史
 *
 * POST /api/clients/[id]/execution/[itemId]/luban
 *   Body: { message: string }
 *   → FDE 发一条消息，鲁班回复（非流式，5-15s）
 *   → 返回 { success, reply, meta }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { chatWithLuban } from '@/lib/luban/agent'

export const dynamic = 'force-dynamic'
// 鲁班 tool loop 单轮可能跨：初次 Claude 调用（~20s）+ generate_content 工具内
// 同步跑 generateBlogPost（~20-40s）+ 收尾 Claude 调用（~20s）。给足预算避免在
// 落库草稿后、聊天回复持久化前超时。
export const maxDuration = 180

interface LubanMessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

// ─── GET — 对话历史 ───────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { itemId } = params

    const { data, error } = await supabaseAdmin
      .from('luban_messages')
      .select('id, role, content, created_at')
      .eq('execution_item_id', itemId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[luban GET] db error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load conversation' }, { status: 500 })
    }

    return NextResponse.json(
      { success: true, messages: (data ?? []) as LubanMessageRow[] },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err: unknown) {
    console.error('[luban GET] unexpected:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ─── POST — 发消息 ───────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { itemId } = params
    const body = (await req.json()) as { message?: string }
    const message = (body.message ?? '').trim()

    if (!message) {
      return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    }

    const result = await chatWithLuban(supabaseAdmin, itemId, clientId, message)

    return NextResponse.json({
      success: true,
      reply: result.reply,
      meta: {
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        cost_usd: result.cost_usd,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[luban POST] error:', msg, err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
