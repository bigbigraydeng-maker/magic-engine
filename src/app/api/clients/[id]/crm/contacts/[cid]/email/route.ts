/**
 * GET /api/clients/[id]/crm/contacts/[cid]/email
 *
 * 这个人的邮件线索——只为回答一件事：**在 CRM 里能不能当场回他**。
 * 照 `.../messenger/route.ts` 的样板写（那份文件头写的道理原样成立，换了渠道）。
 *
 * 邮件没有 Messenger 那种 24 小时/7 天回复窗口——不返回 `replyWindow`，
 * 前端据此不显示窗口提示，发送按钮也不会因为「窗口」被禁用。真正挡发送的
 * 是「这个人有没有来过信」，那件事留给 `sendMailReply` 在发送那一刻判断
 * （没有客人来信会报 409 `no_thread`），这里不重复猜。
 *
 * Responses:
 *   200  { conversationId, participantName } —— 能回
 *   200  { conversationId: null }            —— 这个人没有邮件线
 *   401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

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
  // 「上游查对了」这种假设成立（见 mail-send.ts 的同款复核）。
  const { data: convo, error } = await supabaseAdmin
    .from('conversations')
    .select('id, participant_name')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    // 只认邮件。这条路由的结果直接决定卡片上给不给「在这里回邮件」的框——
    // 拿到一条私信线程，销售会对着一个从没收过他邮件的人打字。
    .eq('channel', 'email')
    // 同一个人可能连了不止一条邮件线程——回最新的那条，那才是他还在说话的地方。
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: '读取失败' }, { status: 500 })
  }
  if (!convo) {
    return NextResponse.json({ conversationId: null })
  }

  return NextResponse.json({
    conversationId: convo.id,
    participantName: convo.participant_name ?? null,
  })
}
