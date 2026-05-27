/**
 * POST /api/clients/[id]/execution/[itemId]/log
 *
 * FDE 给执行项添加一条工作日志（鲁班执行代理 P8.10.S4.1）。
 *
 * Body: {
 *   kind:    'note' | 'blocker' | 'ai_assist'   — 默认 'note'
 *   content: string                            — 日志内容
 *   author?: 'fde' | 'luban'                   — 默认 'fde'；存鲁班回复时传 'luban'
 * }
 *
 * Returns: { success, log }
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { ExecutionLog, ExecutionLogKind, ExecutionLogAuthor } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'

// 经此端点可写的类型（status_change/adjustment 由系统写）
// ai_assist = FDE 把鲁班的对话回复"存为工作记录"
const ALLOWED_KINDS: ExecutionLogKind[] = ['note', 'blocker', 'ai_assist']

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { itemId } = params
    const body = (await req.json()) as {
      kind?: ExecutionLogKind
      content?: string
      author?: ExecutionLogAuthor
    }

    const kind: ExecutionLogKind =
      body.kind && ALLOWED_KINDS.includes(body.kind) ? body.kind : 'note'
    const author: ExecutionLogAuthor =
      body.author === 'luban' ? 'luban' : 'fde'
    const content = (body.content ?? '').trim()

    if (!content) {
      return NextResponse.json({ success: false, error: 'content is required' }, { status: 400 })
    }

    // 校验执行项存在且属于该客户
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('execution_items')
      .select('id')
      .eq('id', itemId)
      .eq('client_id', clientId)
      .single<{ id: string }>()

    if (itemErr || !item) {
      return NextResponse.json({ success: false, error: 'Execution item not found' }, { status: 404 })
    }

    const { data: log, error: insertErr } = await supabaseAdmin
      .from('execution_logs')
      .insert({
        execution_item_id: itemId,
        client_id:         clientId,
        author,
        kind,
        content,
        meta:              null,
      })
      .select('*')
      .single<ExecutionLog>()

    if (insertErr || !log) {
      console.error('[execution/:itemId/log POST] insert failed:', insertErr)
      return NextResponse.json({ success: false, error: 'Failed to add log' }, { status: 500 })
    }

    return NextResponse.json({ success: true, log })
  } catch (err: unknown) {
    console.error('[execution/:itemId/log POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
