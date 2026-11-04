import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/clients/[id]/crm/call-analyses/[aid]/transcript
 *
 * 一通电话的完整文字稿（只读）。分析卡片里每条事实只带一小段原话（过长会被截成「…」），
 * 复核的人要能读完整段通话，才判得出 AI 整理得对不对（PM 2026-10-29）。
 *
 * IDOR：分析必须属于 path 上的 client（.eq client_id），文字稿也按 client_id 收口，否则 404。
 *
 * Responses: 200 { text } / 401 / 403 / 404 / 500
 */

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; aid: string } },
): Promise<NextResponse> {
  const { id: clientId, aid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: analysis, error: aErr } = await supabaseAdmin
    .from('telephony_call_analyses')
    .select('call_id')
    .eq('id', aid)
    .eq('client_id', clientId)
    .maybeSingle()
  if (aErr) {
    console.error('[crm/call-analyses/transcript] 读分析失败:', aErr.message)
    return NextResponse.json({ error: '读取失败' }, { status: 500 })
  }
  if (!analysis) return NextResponse.json({ error: '分析不存在' }, { status: 404 })

  const { data: tr, error: tErr } = await supabaseAdmin
    .from('telephony_transcripts')
    .select('body')
    .eq('call_id', (analysis as { call_id: string }).call_id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (tErr) {
    console.error('[crm/call-analyses/transcript] 读文字稿失败:', tErr.message)
    return NextResponse.json({ error: '读取失败' }, { status: 500 })
  }
  const text = typeof tr?.body === 'string' ? tr.body.trim() : ''
  if (!text) return NextResponse.json({ error: '这通电话没有文字稿' }, { status: 404 })

  return NextResponse.json({ text })
}
