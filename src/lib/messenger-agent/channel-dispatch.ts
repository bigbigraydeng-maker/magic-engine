/**
 * 渠道查表分发 —— CTS Governed Reply Agent（issue #1578，issue #1745 加邮件）。
 *
 * F1（Messenger/WhatsApp 安抚）/ F2（AI 起草→发送主链路，现含邮件）/ F3 / F4
 * 四个 Inngest 函数共用同一套「起草 → 验证 → 发送 → 收尾」骨架，唯一的区别是
 * 渠道本身：调哪个发送函数、怎么判定发送窗口关没关、查哪一列 kill switch、
 * 发送结果里消息 id 叫什么字段。这个文件把这几件"渠道差异"收进三张查表 + 两个
 * 归一化函数，业务逻辑里不需要再散落 `if (channel === 'whatsapp')`。
 *
 * ## 邮件没有 F1（自动安抚）——这是刻意的业务判断，不是漏做
 *
 * issue #1745 调研结论明确留白：F1 那种"客户消息进来几秒内自动回一句安抚话术"
 * 对邮件（靠每小时同步，不是 webhook 实时）价值存疑，这属于业务判断，不是本次
 * 改动能替 PM 拍板的事——所以邮件只接入 F2（AI 起草→人审→发送），不接入 F1。
 * 见 `conversation-inbound-autoack.ts` 的 `isKnownAutoAckChannel`（消费方），
 * 和 `conversation-inbound-draft.ts` 用同一个函数判断"这个渠道要不要等 F1"。
 *
 * ## 不是 `lib/messaging/channels.ts` 的 `MessagingChannelAdapter`
 *
 * 仓库里已经有一套正式的 `ChannelAdapter` 接口（`isConnected`/`window`/`send`
 * 三方法 + `registerChannel`/`sendOnChannel` 注册表，2026-08-02 建，服务"人工
 * 在 CRM 里点发送"场景，目前没有生产调用方）。本文件**刻意保持独立**，不接入
 * 那套总线——两者服务的场景不同（一个是人工点发送给人看的文案，一个是 AI
 * 起草 + 治理后自动发、要喂给 Inngest 收尾逻辑的机器可读归一化），`SendResult`/
 * `SendWindow` 的语义也不完全对齐：`getSentMessageId`/`isWindowClosed` 这里
 * 需要的是"这条消息的 provider message id 是什么"「这个窗口算不算关了」这类
 * 供代码判断用的窄归一化，`channels.ts` 的 `SendResult` 是给 CRM 页面直接展示
 * 的人话文案。强行合并两套语义，两头都会变得不贴切。详见 issue #1578 的开放
 * 问题讨论——这是实现细节判断，已在 PR 描述里留痕给复审看，不是本 issue 代为
 * 拍板。
 *
 * ## Kill switch 查询为什么不缓存
 *
 * `offerings-loader.ts` 的 5 分钟内存缓存是给"几乎不变"的配置用的；这里的
 * kill switch 是回滚安全阀——PM 拍下"关掉 CTS 的 Messenger 自动回复"之后，
 * 系统必须在秒级内停止发送，不能让一次内存缓存把关闸的生效时间拖到 5 分钟后。
 * 所以每次都直查 `clients` 表，不经过任何缓存层。
 *
 * ## fail-closed：查不到 / 查错 / 不认识的渠道，一律当"关"
 *
 * 这是唯一的回滚安全阀，出错方向必须只有一个：宁可少发，不能因为一次网络抖动
 * 或渠道名拼错就被当成"开着"处理，继续对客户自动发消息。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { sendReply, messagingWindow, type SendReplyResult } from '@/lib/messenger/send'
import { sendWhatsApp, whatsappWindow, type SendWhatsAppResult } from '@/lib/whatsapp/send'
import { sendMailReply, mailReplyWindow, type SendMailReplyResult } from '@/lib/microsoft/mail-send'

export type MessengerAgentChannel = 'messenger' | 'whatsapp' | 'email'

/** 三个渠道结果的合并类型——`getSentMessageId` 按渠道分别取字段时要用到。 */
export type ChannelSendResult = SendReplyResult | SendWhatsAppResult | SendMailReplyResult

/** 渠道 → 实际发送函数。三个函数的入参形状相同（`clientId`/`conversationId`/`body`/`sentByEmail`/`usedAiDraft`）。 */
export const CHANNEL_SEND = {
  messenger: sendReply,
  whatsapp: sendWhatsApp,
  email: sendMailReply,
} as const

/** 渠道 → 判定发送窗口的纯函数。入参形状相同（`lastInboundAt`/可选 `now`，邮件不认 `now`——见 `mailReplyWindow` 头注释）。 */
export const CHANNEL_WINDOW = {
  messenger: messagingWindow,
  whatsapp: whatsappWindow,
  email: mailReplyWindow,
} as const

/** 渠道 → `clients` 表里对应的 kill switch 列名（issue #1574/#1745 新增，三列，默认 false）。 */
const CHANNEL_KILL_SWITCH_COLUMN = {
  messenger: 'messenger_agent_enabled_messenger',
  whatsapp: 'messenger_agent_enabled_whatsapp',
  email: 'messenger_agent_enabled_email',
} as const

function isKnownChannel(channel: string): channel is MessengerAgentChannel {
  return channel === 'messenger' || channel === 'whatsapp' || channel === 'email'
}

/**
 * 这个客户的这个渠道，自动回复开着吗。
 *
 * fail-closed：未识别的 channel 字符串、查询报错、查不到客户行，一律返回
 * `false`——不抛异常（调用方不需要 try/catch 才能安全判断），也不因为"查不到"
 * 就默认放行。不经过任何缓存，直查 `clients` 表，TTL 等价于 0（见文件头注释）。
 */
export async function isChannelEnabled(
  clientId: string,
  channel: string,
  supabase: SupabaseClient = supabaseAdmin,
): Promise<boolean> {
  if (!isKnownChannel(channel)) {
    console.error(`[messenger-agent/channel-dispatch] 未识别的渠道 channel=${channel}，按关闭处理`)
    return false
  }

  const column = CHANNEL_KILL_SWITCH_COLUMN[channel]
  const { data, error } = await supabase
    .from('clients')
    .select(column)
    .eq('id', clientId)
    .maybeSingle()

  if (error) {
    console.error(
      `[messenger-agent/channel-dispatch] 查 kill switch 失败 clientId=${clientId} channel=${channel}:`,
      error.message,
    )
    return false // fail-closed：查询报错不能当"开"处理。
  }
  if (!data) {
    console.error(`[messenger-agent/channel-dispatch] 客户不存在 clientId=${clientId}`)
    return false
  }

  return (data as Record<string, unknown>)[column] === true
}

/**
 * 从发送结果里取出 provider 那边的消息 id，三个渠道字段名不同
 * （Messenger 是 `metaMessageId`，WhatsApp 是 `whatsappMessageId`，
 * 邮件是 `messageId`——见 `mail-send.ts::SendMailReplyResult`）。
 * 发送失败（`ok: false`）或渠道跟结果形状对不上时返回 `null`。
 */
export function getSentMessageId(channel: MessengerAgentChannel, result: ChannelSendResult): string | null {
  if (!result.ok) return null
  if (channel === 'messenger' && 'metaMessageId' in result) return result.metaMessageId
  if (channel === 'whatsapp' && 'whatsappMessageId' in result) return result.whatsappMessageId
  if (channel === 'email' && 'messageId' in result) return result.messageId
  return null
}

/**
 * 这个窗口状态算不算"关了，不能自由发消息"。三个渠道的"关闭"取值不同
 * （Messenger 是 `'closed'`，WhatsApp 是 `'template_only'`，邮件也是 `'closed'`
 * ——见 `mailReplyWindow`，客人没来过信才会是这个态）。未识别的渠道按
 * "已关闭"处理（fail-closed 的同一个方向：宁可判成关了拦下，不误判成开着放行）。
 */
export function isWindowClosed(channel: MessengerAgentChannel, windowKind: string): boolean {
  if (channel === 'messenger') return windowKind === 'closed'
  if (channel === 'whatsapp') return windowKind === 'template_only'
  if (channel === 'email') return windowKind === 'closed'
  console.error(`[messenger-agent/channel-dispatch] 未识别的渠道 channel=${channel}，按窗口已关闭处理`)
  return true
}
