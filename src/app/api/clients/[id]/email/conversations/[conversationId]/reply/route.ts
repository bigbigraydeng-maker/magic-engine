/**
 * POST /api/clients/[id]/email/conversations/[conversationId]/reply
 *
 * Send an email reply as the client's connected mailbox.照 messenger 那条
 * reply 路由的样板写（`src/app/api/clients/[id]/messenger/conversations/
 * [conversationId]/reply/route.ts`）——同一个人工发送场景，同一套鉴权/校验
 * 形状，换了底层 provider。
 *
 * Body: { body: string }
 *
 * Responses:
 *   200  { ok: true, messageId }
 *   400  empty body
 *   401  not authenticated
 *   403  not a member of this client, or the thread belongs to another client
 *   404  conversation not found
 *   409  not an email conversation, or no message to reply to
 *   424  mailbox not connected / auth expired
 *   502  Microsoft Graph rejected the message
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendMailReply } from '@/lib/microsoft/mail-send'

interface RouteParams {
  params: { id: string; conversationId: string }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const email = access.user.email?.toLowerCase().trim()
  if (!email) {
    return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })
  }

  let payload: { body?: unknown }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (typeof payload.body !== 'string') {
    return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 })
  }

  const result = await sendMailReply({
    clientId: params.id,
    conversationId: params.conversationId,
    body: payload.body,
    sentByEmail: email,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  }

  return NextResponse.json({ ok: true, messageId: result.messageId })
}
