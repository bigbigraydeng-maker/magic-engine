/**
 * 项目级鲁班对话 API（P8.10.S5.3）
 *
 * GET  /api/clients/[id]/luban
 *   → 加载该客户的项目级鲁班对话历史
 *
 * POST /api/clients/[id]/luban
 *   Body: { message: string }
 *   → FDE 发一条消息，项目级鲁班基于全项目上下文回复（非流式）
 *
 * 区别于 /execution/[itemId]/luban（单执行项级）：这里鲁班看的是整个项目。
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { chatWithProjectLuban } from '@/lib/luban/project-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ProjectLubanMessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

// ─── GET — 对话历史 ───────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {

    const { data, error } = await supabaseAdmin
      .from('luban_project_messages')
      .select('id, role, content, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[project-luban GET] db error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load conversation' }, { status: 500 })
    }

    return NextResponse.json(
      { success: true, messages: (data ?? []) as ProjectLubanMessageRow[] },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err: unknown) {
    console.error('[project-luban GET] unexpected:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ─── POST — 发消息 ───────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const body = (await req.json()) as { message?: string }
    const message = (body.message ?? '').trim()

    if (!message) {
      return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    }

    const result = await chatWithProjectLuban(supabaseAdmin, clientId, message)

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
    console.error('[project-luban POST] error:', msg, err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
