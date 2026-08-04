/**
 * GET /api/clients/[id]/messenger/conversations/[conversationId]/messages
 *
 * The raw thread behind a brief. The card is what staff act on, but two things
 * need the transcript itself:
 *   - checking the AI when the card reads oddly (the no-API-key fallback brief
 *     tells the reader to do exactly that)
 *   - knowing the real reply window before typing. The list view can only
 *     compute it for threads where the customer spoke last; here we have the
 *     customer's actual last message, so this is the authoritative countdown.
 *
 * Responses:
 *   200  { messages: [...], replyWindow: { kind, msRemaining } }
 *   401  not authenticated
 *   403  not a member of this client
 *   404  no such thread for this client
 *   500  query failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { messagingWindow } from '@/lib/messenger/send'

interface RouteParams {
  params: { id: string; conversationId: string }
}

interface MessageRow {
  direction: 'inbound' | 'outbound'
  sender_name: string | null
  body: string | null
  sent_at: string
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // The conversation id comes from the URL, so ownership is proven here rather
  // than inferred from the client id the guard just verified — same rule the
  // send path follows.
  const { data: convo } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('id', params.conversationId)
    .eq('client_id', params.id)
    // 只认私信 —— 这个接口的返回会被渲染成私信气泡并配 Meta 回复框。
    .eq('channel', 'messenger')
    .maybeSingle()

  if (!convo) {
    return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('direction, sender_name, body, sent_at')
    .eq('conversation_id', params.conversationId)
    .order('sent_at', { ascending: true })
    .limit(300)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as MessageRow[]
  const lastInboundAt =
    [...rows].reverse().find((m) => m.direction === 'inbound')?.sent_at ?? null
  const window = messagingWindow(lastInboundAt)

  return NextResponse.json({
    messages: rows.map((m) => ({
      direction: m.direction,
      senderName: m.sender_name,
      body: m.body ?? '',
      sentAt: m.sent_at,
    })),
    replyWindow: { kind: window.kind, msRemaining: window.msRemaining },
  })
}
