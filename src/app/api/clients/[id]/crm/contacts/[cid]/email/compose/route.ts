/**
 * POST /api/clients/[id]/crm/contacts/[cid]/email/compose
 *
 * 在 CRM 里给一个**还没有邮件往来**的客人发第一封邮件（真人点发送才会调）。
 * 设计稿：docs/specs/2026-10-21-crm-send-first-email-design-v0.md
 *
 * Body: { subject, body, requestId, expectedRecipient }
 *   requestId          前端每个「写邮件」框生成一次的 UUID；双击 / 重试用同一个，服务端据此不重复发
 *   expectedRecipient  抽屉上显示的收件地址；和服务端最终取的不一致就拒发
 *
 * 所有的闸（开关、只发给咨询过的人、别再联系、配额、防重复…）都在 `sendMailNew` 里，这里只做鉴权和翻译。
 *
 * Responses: 200 { ok, messageId, conversationId, duplicate? } / 400 / 401 / 403 / 404 / 409 / 424 / 429 / 502 / 503
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendMailNew } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const sentByEmail = access.user.email?.toLowerCase().trim()
  if (!sentByEmail) {
    return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })
  }

  let payload: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    payload = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const result = await sendMailNew(
    {
      clientId: params.id,
      contactId: params.cid,
      subject: payload.subject,
      body: payload.body,
      sentByEmail,
      requestId: payload.requestId,
      expectedRecipient: payload.expectedRecipient,
    },
    createMailNewDeps(),
  )

  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  }
  return NextResponse.json({ ok: true, messageId: result.messageId, conversationId: result.conversationId, duplicate: result.duplicate === true })
}
