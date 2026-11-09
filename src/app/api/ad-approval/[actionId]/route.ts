/**
 * POST /api/ad-approval/[actionId]   { decision: 'approve' | 'reject', reason? }
 *
 * 「开」不再走这里。开投只认确认卡（/api/clients/[id]/go-live-cards）。
 * 这个入口若收到 approve，直接拒绝，不读令牌，不写广告。
 * 「先不投」仍只改账本，广告保持暂停。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { rejectDraft, ADS_CREATE_ACTION } from '@/lib/ads-strategy/draft-and-gate'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ actionId: string }> },
): Promise<NextResponse> {
  const { actionId } = await params

  let body: { decision?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const decision = body.decision
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision 必须是 approve 或 reject' }, { status: 400 })
  }

  // 先查这条属于哪个客户，再按那个客户鉴权 —— 不能让 A 客户的人开 B 客户的广告。
  const { data, error: lookupError } = await supabaseAdmin
    .from('flywheel_actions')
    .select('client_id')
    .eq('id', actionId)
    .eq('action_type', ADS_CREATE_ACTION)
    .maybeSingle()

  if (lookupError) return NextResponse.json({ error: '暂时查不到这条草案，已拒绝。' }, { status: 503 })

  const clientId = (data as { client_id?: string } | null)?.client_id
  if (!clientId) return NextResponse.json({ error: '找不到这条草案' }, { status: 404 })

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  if (decision === 'approve') {
    return NextResponse.json(
      { error: '开投要在确认卡上点。这个入口不再直接开启广告。' },
      { status: 409 },
    )
  }

  const r = await rejectDraft(
    actionId,
    supabaseAdmin,
    typeof body.reason === 'string' ? body.reason : undefined,
  )
  return r.ok
    ? NextResponse.json({ ok: true, status: 'rejected' })
    : NextResponse.json({ error: r.error }, { status: 400 })
}
