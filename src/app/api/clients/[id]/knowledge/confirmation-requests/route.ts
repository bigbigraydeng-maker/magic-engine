/**
 * 客户确认链接 API（issue #1646，design doc §9.4）。
 *
 * GET  —— 这个客户「ME 已批、还等客户签字」的敏感条目 + 已登记的确认人 + 最近发过的确认链接。
 * POST —— 选中若干条，给某个已登记的确认人发一条一次性确认链接。
 *
 * 🔴 原始令牌只在两个地方出现：这条路由的内存里，和发出去那封邮件的 URL 里。
 *    它**不写库**（库里只有 sha256），也**不进 API 响应**——响应里带回去
 *    就等于把它塞进浏览器历史、前端日志和任何抓包工具，那这条链接就不再是
 *    「只有收件人能用」的了。发信失败就重发一条新链接，不回收旧令牌。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { knowledgeWriteClient } from '@/lib/knowledge/admin-client'
import {
  createConfirmationRequest,
  KnowledgeConfirmationError,
} from '@/lib/knowledge/confirmation-requests'
import { listFactsAwaitingCustomerConfirmation } from '@/lib/knowledge/review'
import { getRegisteredConfirmerEmails } from '@/lib/knowledge/confirmers'
import { sendKnowledgeConfirmationRequest } from '@/lib/email/knowledge-confirmation'
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
      response: NextResponse.json({ success: false, error: '只有 Magic Engine 内部人员能发确认链接' }, { status: 403 }),
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
    const [facts, confirmers] = await Promise.all([
      listFactsAwaitingCustomerConfirmation(params.id, sb),
      getRegisteredConfirmerEmails(params.id, sb),
    ])

    const { data: recent, error } = await supabaseAdmin
      .from('client_knowledge_confirmation_requests')
      .select('id, confirmer_email, status, expires_at, confirmed_at, created_at, created_by_email, outcome')
      .eq('client_id', params.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      facts,
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
    return NextResponse.json({ success: false, error: '拿不到登录邮箱，无法记录是谁发的确认链接' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }
  const raw = body as { fact_ids?: unknown; confirmer_email?: unknown } | null
  if (!Array.isArray(raw?.fact_ids) || raw.fact_ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ success: false, error: 'fact_ids 必须是一组条目编号' }, { status: 400 })
  }
  if (typeof raw?.confirmer_email !== 'string' || !raw.confirmer_email.trim()) {
    return NextResponse.json({ success: false, error: '请选择一个已登记的确认人' }, { status: 400 })
  }

  const sb = knowledgeWriteClient()

  let created
  try {
    created = await createConfirmationRequest(sb, {
      clientId: params.id,
      factIds: raw.fact_ids as string[],
      confirmerEmail: raw.confirmer_email,
      actorEmail: gate.actorEmail,
    })
  } catch (err) {
    if (err instanceof KnowledgeConfirmationError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }

  // 拿正文只是为了让邮件里能预览几条，不是授权依据；取不到就发不带预览的信。
  const facts = await listFactsAwaitingCustomerConfirmation(params.id, sb).catch(() => [])
  const selected = new Set(created.factIds)
  const statements = facts.filter((f) => selected.has(f.id)).map((f) => f.statement)

  const origin = getPublicOrigin(req)
  const confirmUrl = `${origin}/knowledge-confirm/${created.requestId}?token=${encodeURIComponent(created.rawToken)}`

  const mail = await sendKnowledgeConfirmationRequest({
    to: created.confirmerEmail,
    clientName: await readClientName(params.id),
    statements,
    confirmUrl,
    expiresAt: created.expiresAt,
  })

  // 🔴 发信失败不假装成功。这条链接已经在库里了，但收件人永远收不到——
  //    FDE 必须知道要重发一条，而不是坐等一个不会来的确认。
  return NextResponse.json({
    success: true,
    request_id: created.requestId,
    confirmer_email: created.confirmerEmail,
    expires_at: created.expiresAt,
    fact_count: created.factIds.length,
    emailed: mail.sent,
    email_error: mail.sent ? undefined : mail.reason,
  })
}
