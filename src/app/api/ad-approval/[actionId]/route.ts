/**
 * POST /api/ad-approval/[actionId]   { decision: 'approve' | 'reject', reason? }
 *
 * 人点头 → 广告真的开始花钱。这是整条链路上**唯一**会让钱动起来的接口。
 *
 * 为什么要单独一个接口、而不是让起草那步自己开（PM 2026-07-28 拍板的产品形态）：
 *   花钱 / 对外可见 / 难撤回 —— 三条全占，所以必须落成一个人点的动作。
 *   ME 把活干到「只剩点头」，但那一下必须是人点的。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import {
  approveDraft,
  rejectDraft,
  ADS_CREATE_ACTION,
} from '@/lib/ads-strategy/draft-and-gate'

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
  const { data } = await supabaseAdmin
    .from('flywheel_actions')
    .select('client_id')
    .eq('id', actionId)
    .eq('action_type', ADS_CREATE_ACTION)
    .maybeSingle()

  const clientId = (data as { client_id?: string } | null)?.client_id
  if (!clientId) return NextResponse.json({ error: '找不到这条草案' }, { status: 404 })

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  if (decision === 'reject') {
    const r = await rejectDraft(
      actionId,
      supabaseAdmin,
      typeof body.reason === 'string' ? body.reason : undefined,
    )
    return r.ok
      ? NextResponse.json({ ok: true, status: 'rejected' })
      : NextResponse.json({ error: r.error }, { status: 400 })
  }

  const accessToken = await getMetaTokenForClient(clientId)
  if (!accessToken) {
    return NextResponse.json({ error: '拿不到这个客户的 Meta 授权' }, { status: 424 })
  }

  const r = await approveDraft(actionId, supabaseAdmin, accessToken)
  return r.ok
    ? NextResponse.json({ ok: true, status: 'active' })
    : NextResponse.json({ error: r.error }, { status: 400 })
}
