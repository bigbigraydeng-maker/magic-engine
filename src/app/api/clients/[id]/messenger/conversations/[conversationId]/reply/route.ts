/**
 * POST /api/clients/[id]/messenger/conversations/[conversationId]/reply
 *
 * Send a Messenger reply as the client's Page. A human must have pressed send —
 * nothing here is triggered by the AI. Every attempt is written to
 * messenger_outbound_log with the signed-in email attached.
 *
 * Body: { body: string, usedAiDraft?: boolean }
 *
 * Responses:
 *   200  { ok: true, window }
 *   400  empty body
 *   401  not authenticated
 *   403  not a member of this client, or the thread belongs to another client
 *   404  conversation not found
 *   409  Meta's reply window has closed
 *   424  Meta auth not configured for this client
 *   502  Meta rejected the message
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendReply } from '@/lib/messenger/send'

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
    // Every outbound message must be attributable to a person; an unattributable
    // send is worse than no send.
    return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })
  }

  let payload: { body?: unknown; usedAiDraft?: unknown }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (typeof payload.body !== 'string') {
    return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 })
  }

  const result = await sendReply({
    clientId: params.id,
    conversationId: params.conversationId,
    body: payload.body,
    sentByEmail: email,
    usedAiDraft: payload.usedAiDraft === true,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  }

  return NextResponse.json({ ok: true, window: result.window })
}
