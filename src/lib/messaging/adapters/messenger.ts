/**
 * Messenger 适配器 —— 总线的第一条线。
 *
 * 它**不新增任何发送能力**：底下走的还是 `lib/messenger/send` 里那条已经上线、
 * 带隔离复核和发送前审计的路。这里只做翻译：把总线的「给这个人发这句话」翻成
 * 「往他那条会话里发」。
 *
 * 为什么第一条线选 Messenger 而不是 WhatsApp：它是唯一已经在跑的渠道（CTS 有
 * 515 条会话），拿它验证总线的形状，比拿一条还没接通的线去猜要稳。WhatsApp
 * 适配器照着这一份写就行。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { messagingWindow, sendReply } from '@/lib/messenger/send'
import type { ChannelAdapter, SendInput, SendResult, SendWindow } from '../channels'

/** 这个人在 Messenger 上的那条会话（多条取最新 —— 那才是他还在说话的地方）。 */
async function latestConversationId(clientId: string, contactId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .eq('channel', 'messenger')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * 客人最后一次说话的时间 —— 窗口从这里算起。
 *
 * 读的是他真正的最后一条 inbound，不是会话表上那个「最后一条是谁发的」摘要列：
 * 我们回过之后那一列就变成我们，按它算会误判成「不能回了」；按会话的最后活动
 * 时间算，又会因为我们自己发的消息凭空多出 24 小时。
 */
async function lastInboundAt(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversation_messages')
    .select('sent_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.sent_at as string | undefined) ?? null
}

export const messengerAdapter: ChannelAdapter = {
  channel: 'messenger',

  /**
   * 这个客户有没有在用 Messenger —— 看他名下有没有会话。
   *
   * 不去问 Meta「授权还在不在」：那要一次网络往返，而这个判断只用来决定
   * 页面上给不给入口。授权掉线的真实反馈在发送那一刻给（`no_token`），
   * 那才是人能当场行动的时刻。
   */
  async isConnected(clientId: string): Promise<boolean> {
    const { count } = await supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('channel', 'messenger')
    return (count ?? 0) > 0
  },

  async window(clientId: string, contactId: string): Promise<SendWindow> {
    const conversationId = await latestConversationId(clientId, contactId)
    // 没有会话 = 从没跟他在 Messenger 上说过话。Meta 不允许主动开口，
    // 所以这是「关着」，不是「还没试过」。
    if (!conversationId) return { kind: 'closed', msRemaining: 0 }

    const win = messagingWindow(await lastInboundAt(conversationId))
    if (win.kind === 'closed') return { kind: 'closed', msRemaining: 0 }
    // standard 和 human_agent 对上层是同一件事：现在能自由回。
    // 两者的区别（24 小时 / 7 天）是 Meta 的内部规则，销售不需要知道。
    return { kind: 'open', msRemaining: win.msRemaining }
  },

  async send(input: SendInput): Promise<SendResult> {
    const conversationId = await latestConversationId(input.clientId, input.contactId)
    if (!conversationId) {
      return { ok: false, code: 'no_address', reason: '他没有 Messenger 对话，发不了' }
    }

    const res = await sendReply({
      clientId: input.clientId,
      conversationId,
      body: input.body,
      sentByEmail: input.sentByEmail,
      // 总线这一层没有 AI 草稿的概念 —— 谁用了草稿由调用方自己报，
      // 这里如实报「没用」，不替调用方猜（那会污染审计）。
      usedAiDraft: false,
    })

    if (res.ok) return { ok: true, externalMessageId: res.metaMessageId }

    // 把底层的原因翻成总线的词汇，并且**说人话** —— 页面直接拿去显示。
    if (res.reason === 'window_closed') {
      return { ok: false, code: 'window_closed', reason: 'Facebook 已经不让回这条了，请改用电话或邮件' }
    }
    if (res.reason === 'no_token') {
      return { ok: false, code: 'not_connected', reason: 'Facebook 授权掉线了，请找 Magic Lab 团队重连' }
    }
    return { ok: false, code: 'failed', reason: res.error }
  },
}
