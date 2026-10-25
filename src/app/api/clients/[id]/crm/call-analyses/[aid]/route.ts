import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/clients/[id]/crm/call-analyses/[aid]
 *
 * 按需读取通话转写。转写正文只在明确展开时间线卡片时返回，且不进入缓存。
 *
 * PATCH /api/clients/[id]/crm/call-analyses/[aid]
 *
 * 人工复核一份通话分析：确认无误 / 驳回 / 撤回成待复核。
 * 只改这份分析自己的复核状态：不改联系人、不改阶段、不外发、不进学习样本。
 *
 * IDOR：分析必须属于 path 上的 client（同时 .eq client_id），否则 404。
 *
 * Body: { review: 'confirmed' | 'rejected' | 'pending_review' }
 * Responses: 200 { reviewStatus } / 400 / 401 / 403 / 404 / 500
 */

export const dynamic = 'force-dynamic'

const ALLOWED = ['confirmed', 'rejected', 'pending_review'] as const
type Review = (typeof ALLOWED)[number]

function noStoreJson(body: Record<string, unknown>, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; aid: string } },
): Promise<NextResponse> {
  const { id: clientId, aid } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return noStoreJson({ error: access.error }, access.status)

  const { data: analysis, error: analysisError } = await supabaseAdmin
    .from('telephony_call_analyses')
    .select('id, call_id')
    .eq('id', aid)
    .eq('client_id', clientId)
    .maybeSingle()

  if (analysisError) return noStoreJson({ error: '读取通话记录失败' }, 500)
  if (!analysis) return noStoreJson({ error: '分析不存在' }, 404)

  const { data: call, error: callError } = await supabaseAdmin
    .from('telephony_calls')
    .select('id')
    .eq('id', analysis.call_id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (callError) return noStoreJson({ error: '读取通话记录失败' }, 500)
  if (!call) return noStoreJson({ error: '分析不存在' }, 404)

  const { data: transcript, error: transcriptError } = await supabaseAdmin
    .from('telephony_transcripts')
    .select('body')
    .eq('call_id', analysis.call_id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (transcriptError) return noStoreJson({ error: '读取通话记录失败' }, 500)
  if (!transcript || typeof transcript.body !== 'string') return noStoreJson({ error: '通话记录不存在' }, 404)

  return noStoreJson({ transcript: transcript.body })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; aid: string } },
): Promise<NextResponse> {
  const { id: clientId, aid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let review: Review
  try {
    const body = (await req.json()) as { review?: unknown }
    if (typeof body.review !== 'string' || !(ALLOWED as readonly string[]).includes(body.review)) {
      return NextResponse.json({ error: 'review 必须是 confirmed / rejected / pending_review' }, { status: 400 })
    }
    review = body.review as Review
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const pending = review === 'pending_review'
  const { data, error } = await supabaseAdmin
    .from('telephony_call_analyses')
    .update({
      review_status: review,
      reviewed_by: pending ? null : (access.user.email ?? null),
      reviewed_at: pending ? null : new Date().toISOString(),
    })
    .eq('id', aid)
    .eq('client_id', clientId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[crm/call-analyses] 更新失败:', error.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: '分析不存在' }, { status: 404 })

  return NextResponse.json({ reviewStatus: review })
}
