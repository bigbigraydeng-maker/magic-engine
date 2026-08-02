/**
 * GET /api/clients/[id]/crm/contacts/[cid]/messenger
 *
 * 这个人的 Messenger 线索 —— 只为回答一件事：**在 CRM 里能不能当场回他**。
 *
 * 为什么需要它（2026-08-02 PM 反馈）：CRM 卡片上会对 110 位 CTS 客人写
 * 「没留电话 —— 只能在 Messenger 回他」，但这一页当时没有任何回复入口，
 * 销售看到了却得跳去另一个页面、再从几百条会话里翻出这个人。承诺一件事
 * 又不给做，比不承诺更伤这一页的可信度。
 *
 * 刻意不做的事：
 *  · **不新增任何发送能力**。发送仍然走既有的 `/messenger/conversations/
 *    [conversationId]/reply`（那里有隔离复核、发送前审计、24 小时窗口拦截）。
 *    这里只回答「哪条会话」和「还能不能回」。
 *  · **不给 AI 草稿**。PM 2026-07-26 定的规矩是 AI 只写草稿、人按发送；
 *    CRM 这一侧本来就没有草稿，就老实空着，不去别处凑一个。
 *
 * 回复窗口用跟私信页**同一个** `messagingWindow()` 算，两处不会各说各话。
 *
 * Responses:
 *   200  { conversationId, participantName, replyWindow } —— 能回
 *   200  { conversationId: null }                        —— 这个人没有私信线
 *   401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { messagingWindow } from '@/lib/messenger/send'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id: clientId, cid: contactId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // client_id 一起进 where —— 会话 id 虽然是我们自己查出来的，但隔离不靠
  // 「上游查对了」这种假设成立（见 messenger/send.ts 的同款复核）。
  const { data: convo, error } = await supabaseAdmin
    .from('conversations')
    .select('id, participant_name')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    // 同一个人可能有多条线（换过页面、合并过身份）—— 回最新的那条，
    // 那才是他还在说话的地方。
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: '读取失败' }, { status: 500 })
  }
  if (!convo) {
    return NextResponse.json({ conversationId: null })
  }

  // 窗口从**客人最后一次说话**算起，所以这里读的是他真正的最后一条消息，
  // 而不是会话表上那个「最后一条是谁发的」的摘要列：我们回过之后那一列就
  // 变成了我们，按它算会误判成「不能回了」；反过来若按会话的最后活动时间算，
  // 又会因为我们自己发的消息凭空多出 24 小时，让人以为还能回、结果被 Meta
  // 拒掉。私信页的权威窗口也是这么取的，两处不会各说各话。
  const { data: lastInbound } = await supabaseAdmin
    .from('conversation_messages')
    .select('sent_at')
    .eq('conversation_id', convo.id)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    conversationId: convo.id,
    participantName: convo.participant_name ?? null,
    replyWindow: messagingWindow(lastInbound?.sent_at ?? null, new Date()),
  })
}
