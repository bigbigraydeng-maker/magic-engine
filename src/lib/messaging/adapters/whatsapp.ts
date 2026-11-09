/**
 * WhatsApp 适配器 —— 总线的第二条线，照 `messenger.ts` 那份样板写的
 * （那份文件头写着「WhatsApp 适配器照着这一份写就行」）。
 *
 * 跟 Messenger 那份的差异只有两处，都是渠道本身的差异，不是设计选择：
 *   1. 窗口规则不同 —— WhatsApp 是 24 小时客服窗口，没有 Messenger 那种
 *      7 天 human_agent 续期档（见 `lib/whatsapp/send.ts` 文件头的窗口范围说明）
 *   2. 授权模型不同 —— Messenger 走 per-client OAuth token，WhatsApp 走
 *      ME 一个 System User token 管全部共享进来的号码（见同一处说明）
 *
 * 不新增任何发送能力：底下走的是 `lib/whatsapp/send.ts` 那条新写的、
 * 但结构跟 Messenger 那条一一对应的路。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { sendWhatsApp, whatsappWindow } from '@/lib/whatsapp/send'
import type { ChannelAdapter, SendInput, SendResult, SendWindow } from '../channels'

/** 这个人在 WhatsApp 上的那条会话（多条取最新）。 */
async function latestConversationId(clientId: string, contactId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

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

export const whatsappAdapter: ChannelAdapter = {
  channel: 'whatsapp',

  /** 有没有在用 WhatsApp —— 看他名下有没有该渠道的会话，跟 messenger 判法一致。 */
  async isConnected(clientId: string): Promise<boolean> {
    const { count } = await supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('channel', 'whatsapp')
    return (count ?? 0) > 0
  },

  async window(clientId: string, contactId: string): Promise<SendWindow> {
    const conversationId = await latestConversationId(clientId, contactId)
    if (!conversationId) return { kind: 'closed', msRemaining: 0 }

    const win = whatsappWindow(await lastInboundAt(conversationId))
    if (win.kind === 'template_only') return { kind: 'template', msRemaining: 0 }
    return { kind: 'open', msRemaining: win.msRemaining }
  },

  async send(input: SendInput): Promise<SendResult> {
    const conversationId = await latestConversationId(input.clientId, input.contactId)
    if (!conversationId) {
      return { ok: false, code: 'no_address', reason: '他没有 WhatsApp 对话，发不了' }
    }

    const res = await sendWhatsApp({
      clientId: input.clientId,
      conversationId,
      body: input.body,
      sentByEmail: input.sentByEmail,
      usedAiDraft: false,
    })

    if (res.ok) return { ok: true, externalMessageId: res.whatsappMessageId }

    if (res.reason === 'window_closed') {
      return {
        ok: false,
        code: 'window_closed',
        reason: 'WhatsApp 免费窗口已关闭，只能发模板消息（未接入）或改用电话/邮件',
      }
    }
    if (res.reason === 'no_token') {
      return { ok: false, code: 'not_connected', reason: 'WhatsApp 授权掉线了，请找 Magic Lab 团队重连' }
    }
    return { ok: false, code: 'failed', reason: res.error }
  },
}
