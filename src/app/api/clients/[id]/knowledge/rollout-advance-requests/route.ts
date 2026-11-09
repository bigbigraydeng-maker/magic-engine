/**
 * 阶段切换确认链接 API（issue #1648，design doc §7.3 / §9.10）。
 *
 * GET  —— 这个客户当前的阶段 + 已登记的确认人 + 最近发过的阶段切换确认链接。
 * POST —— 申请前进一段（0→1 或 1→2），给某个已登记的确认人发一条一次性
 *         确认链接。
 *
 * 结构照抄同目录下 `confirmation-requests/route.ts`（issue #1646）：
 *
 * 🔴 原始令牌只在两个地方出现：这条路由的内存里，和发出去那封邮件的 URL
 *    里。它**不写库**（库里只有 sha256），也**不进 API 响应**——响应里带
 *    回去就等于把它塞进浏览器历史、前端日志和任何抓包工具，那这条链接就
 *    不再是「只有收件人能用」的了。发信失败就重发一条新链接，不回收旧
 *    令牌。
 *
 * 阶段后退（一键回退）不走这条路由——design doc 明确它是 ME-only、免签、
 * 无链接的即时动作，这条 API 只管"前进"这一半（跟 rollout.ts 的模块边界
 * 完全对应）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { knowledgeWriteClient } from '@/lib/knowledge/admin-client'
import {
  createRolloutAdvanceRequest,
  getCurrentRolloutStage,
  KnowledgeRolloutError,
} from '@/lib/knowledge/rollout'
import { getRegisteredConfirmerEmails } from '@/lib/knowledge/confirmers'
import { sendKnowledgeRolloutConfirmationRequest } from '@/lib/email/knowledge-rollout-confirmation'
import { KnowledgeReadError } from '@/lib/knowledge/errors'

type Params = { params: { id: string } }

async function requireFde(clientId: string) {
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: access.error, reason: access.reason },
        { status: access.status },
      ),
    }
  }
  if (access.tier !== 'admin') {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: '只有 Magic Engine 内部人员能发阶段切换确认链接' }, { status: 403 }),
    }
  }
  return { ok: true as const, actorEmail: (access.user.email ?? '').trim() }
}

async function readClientName(clientId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('clients').select('name').eq('id', clientId).maybeSingle()
  return (data as { name?: string } | null)?.name ?? '你的账户'
}

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireFde(params.id)
  if (!gate.ok) return gate.response

  try {
    const sb = knowledgeWriteClient()
    const [currentStage, confirmers] = await Promise.all([
      getCurrentRolloutStage(params.id, sb),
      getRegisteredConfirmerEmails(params.id, sb),
    ])

    const { data: recent, error } = await supabaseAdmin
      .from('client_knowledge_rollout_advance_requests')
      .select('id, from_stage, to_stage, confirmer_email, status, expires_at, confirmed_at, created_at, created_by_email')
      .eq('client_id', params.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      current_stage: currentStage,
      confirmers: Array.from(confirmers).sort(),
      requests: recent ?? [],
    })
  } catch (err) {
    const message = err instanceof KnowledgeReadError ? err.message : err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireFde(params.id)
  if (!gate.ok) return gate.response
  if (!gate.actorEmail) {
    return NextResponse.json({ success: false, error: '拿不到登录邮箱，无法记录是谁发的阶段切换确认链接' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }
  const raw = body as
    | { to_stage?: unknown; confirmer_email?: unknown; sample_check?: unknown }
    | null
  if (raw?.to_stage !== 1 && raw?.to_stage !== 2) {
    return NextResponse.json({ success: false, error: 'to_stage 必须是 1 或 2' }, { status: 400 })
  }
  if (typeof raw?.confirmer_email !== 'string' || !raw.confirmer_email.trim()) {
    return NextResponse.json({ success: false, error: '请选择一个已登记的确认人' }, { status: 400 })
  }
  let sampleCheck: { sampleSize: number; priceErrors: number; otherAccuracyPct: number } | undefined
  if (raw.to_stage === 2) {
    const check = raw.sample_check as { sampleSize?: unknown; priceErrors?: unknown; otherAccuracyPct?: unknown } | null
    if (
      typeof check?.sampleSize !== 'number' ||
      typeof check?.priceErrors !== 'number' ||
      typeof check?.otherAccuracyPct !== 'number'
    ) {
      return NextResponse.json(
        { success: false, error: '离开客户共测阶段必须先填抽查结果（sampleSize / priceErrors / otherAccuracyPct）' },
        { status: 400 },
      )
    }
    sampleCheck = { sampleSize: check.sampleSize, priceErrors: check.priceErrors, otherAccuracyPct: check.otherAccuracyPct }
  }

  const sb = knowledgeWriteClient()

  let created
  try {
    created = await createRolloutAdvanceRequest(sb, {
      clientId: params.id,
      toStage: raw.to_stage,
      confirmerEmail: raw.confirmer_email,
      actorEmail: gate.actorEmail,
      sampleCheck,
    })
  } catch (err) {
    if (err instanceof KnowledgeRolloutError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }

  const origin = getPublicOrigin(req)
  const confirmUrl = `${origin}/knowledge-rollout-confirm/${created.requestId}?token=${encodeURIComponent(created.rawToken)}`

  const mail = await sendKnowledgeRolloutConfirmationRequest({
    to: created.confirmerEmail,
    clientName: await readClientName(params.id),
    fromStage: created.fromStage,
    toStage: created.toStage,
    confirmUrl,
    expiresAt: created.expiresAt,
  })

  // 🔴 发信失败不假装成功。这条链接已经在库里了，但收件人永远收不到——
  //    FDE 必须知道要重发一条，而不是坐等一个不会来的确认。
  return NextResponse.json({
    success: true,
    request_id: created.requestId,
    confirmer_email: created.confirmerEmail,
    from_stage: created.fromStage,
    to_stage: created.toStage,
    expires_at: created.expiresAt,
    emailed: mail.sent,
    email_error: mail.sent ? undefined : mail.reason,
  })
}
