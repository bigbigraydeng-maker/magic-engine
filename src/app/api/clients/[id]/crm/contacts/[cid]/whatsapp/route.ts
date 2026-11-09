/**
 * GET /api/clients/[id]/crm/contacts/[cid]/whatsapp
 *
 * 这个人的 WhatsApp 线 —— 只回答一件事：**在 CRM 抽屉里能不能当场回他**。
 *
 * 跟隔壁 `messenger/route.ts` 逐行同形（连隔离复核、取最后一条**入站**消息算窗口
 * 的理由都一样），差别只有两处，都写在下面。
 *
 * Responses:
 *   200  { conversationId, participantName, replyWindow } —— 能回
 *   200  { conversationId: null }                        —— 这个人没有 WhatsApp 线
 *   401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { whatsappWindow } from '@/lib/whatsapp/send'
import type { ReplyWindow } from '@/app/dashboard/clients/[id]/messenger/types'

interface RouteParams {
  params: { id: string; cid: string }
}

/**
 * 差别一：把 WhatsApp 的窗口翻成抽屉那个回复框认识的词。
 *
 * 两边的词汇本来不一样 —— Messenger 说 `standard / human_agent / closed`，
 * WhatsApp 说 `open / template_only`。`template_only` 的字面意思是「只能发已审核的
 * 模板消息」，而 **ME 一个模板都没接**（`send.ts` 的 `postToGraph` 固定发
 * `type: 'text'`），所以今天它对顾问的实际含义就是「发不出去」= `closed`。
 *
 * 🔴 **哪天真接上模板，这个映射必须跟着改**，否则顾问会以为发不了、而其实能发。
 * 同理别把这里改成 `human_agent`：那会显示「还能在 X 内回一次」，是假的。
 */
function toReplyWindow(kind: 'open' | 'template_only', msRemaining: number): ReplyWindow {
  return kind === 'open'
    ? { kind: 'standard', msRemaining }
    : { kind: 'closed', msRemaining: 0 }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id: clientId, cid: contactId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // client_id 一起进 where —— 会话 id 是我们自己查出来的，但隔离不靠「上游查对了」
  // 这种假设成立（同 whatsapp/send.ts 里那道复核）。
  const { data: convo, error } = await supabaseAdmin
    .from('conversations')
    .select('id, participant_name')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    // 只认 WhatsApp。这条路由的结果直接决定抽屉里给不给那个输入框 —— 拿到一条
    // Messenger 或邮件线程，顾问会对着一个从没在 WhatsApp 说过话的人打字，
    // 而发送那一步会因为渠道不对被拒（`wrong_channel`），白写一段。
    .eq('channel', 'whatsapp')
    // 同一个人可能有多条线（换过号、合并过身份）—— 回最新的那条，
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

  // 窗口从**客人最后一次说话**算起，所以读的是他真正的最后一条入站消息，而不是
  // 会话表上那个摘要列：我们回过之后那一列就变成了我们，按它算会误判成「不能回了」；
  // 反过来按会话最后活动时间算，又会因为我们自己发的消息凭空多出 24 小时，
  // 让顾问以为还能回、结果被拒。`send.ts` 的权威窗口也是这么取的。
  const { data: lastInbound } = await supabaseAdmin
    .from('conversation_messages')
    .select('sent_at, body')
    .eq('conversation_id', convo.id)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 差别二：窗口用 `whatsappWindow`（24 小时、从客人最后一条算），不是
  // `messagingWindow`（Messenger 的 24h + 7d 人工客服窗）。两条渠道的规则不同，
  // 共用一个算法会让其中一边的倒计时是错的。
  const raw = whatsappWindow(lastInbound?.sent_at ?? null, new Date())

  // AI 起草了但被安全检查拦下的最新一条（只看客人最后一句话之后的）：抽屉里给一行原因提示，
  // 免得顾问以为 AI 没起草、或以为它坏了。读失败按「没有」处理 —— 这只是提示，不挡回复。
  let blockedDraft: { reasons: string[]; createdAt: string } | null = null
  try {
    const { data: blocked } = await supabaseAdmin
      .from('conversation_reply_drafts')
      .select('blocked_reasons, created_at')
      .eq('client_id', clientId)
      .eq('conversation_id', convo.id)
      .eq('verifier_status', 'blocked')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (blocked && (!lastInbound?.sent_at || blocked.created_at >= lastInbound.sent_at)) {
      blockedDraft = {
        reasons: Array.isArray(blocked.blocked_reasons) ? (blocked.blocked_reasons as string[]) : [],
        createdAt: blocked.created_at as string,
      }
    }
  } catch {
    blockedDraft = null
  }

  return NextResponse.json({
    conversationId: convo.id,
    participantName: convo.participant_name ?? null,
    replyWindow: toReplyWindow(raw.kind, raw.msRemaining),
    lastInbound: lastInbound ? { body: (lastInbound.body as string | null) ?? '', sentAt: lastInbound.sent_at as string } : null,
    blockedDraft,
  })
}
