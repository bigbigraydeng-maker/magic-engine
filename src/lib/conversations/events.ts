/**
 * 事件契约（只声明事件名 + payload 形状，不碰 Inngest/数据库 —— 跟
 * `lib/creatomate/events.ts` 同款「契约模块」惯例，保持可脱网单测）。
 *
 * 🔴 **事件名跨 issue 对齐，字符串必须原样一致**：v3 方案把事件命名空间从
 *    `messenger/*` 改成渠道无关的 `conversation/*`。Messenger webhook
 *    （本模块的调用方，issue #1581）和 WhatsApp webhook（issue #1580 之外的
 *    并行任务）emit 的是**同一个事件名**，靠 `data.channel` 区分渠道，不是
 *    靠事件名区分——下游 F1-F4 只订阅一个 trigger 就能收两条渠道的消息。
 *    改这个字符串前必须先跟 WhatsApp 那条线的实现对齐。
 */
import { z } from 'zod'

export const CONVERSATION_MESSAGE_RECEIVED_EVENT = 'conversation/message.received' as const

/**
 * F1（issue #1584）安抚话术发出后的收尾事件，F2（issue #1585）用它做纯 UX 排序
 * （等它先送达，不是拿它判断"要不要继续"）。跟 `CONVERSATION_MESSAGE_RECEIVED_EVENT`
 * 放在同一个文件的理由一样：字符串必须跨 issue 原样一致，这里是唯一真相源。
 * 🔴 F1 的 `conversation-inbound-autoack.ts`（PR #1739，动笔时未合并）目前在自己
 * 文件里本地声明了同名同值的常量——那份实现落地/下次改动时应该改成从这里 import，
 * 不要两处各留一份。
 */
export const CONVERSATION_AUTOACK_SENT_EVENT = 'conversation/autoack.sent' as const

/**
 * F3（issue #1586）人工在门户点批准/改后发送后 emit，F2 的
 * `step.waitForEvent('conversation/reply.approved', { if: 'async.data.draft_id == "..."' })`
 * 消费。同上，F3 的 `conversation-approval-emit.ts`（PR #1741，动笔时未合并）目前
 * 本地声明了同名同值的常量，落地/下次改动时应改成从这里 import。
 */
export const CONVERSATION_REPLY_APPROVED_EVENT = 'conversation/reply.approved' as const

/** `conversations.channel` 的取值——跟 `lib/messaging/channels.ts` 的 CHANNELS 保持一致。 */
export const ConversationChannelSchema = z.enum(['messenger', 'whatsapp', 'email', 'voice'])
export type ConversationChannel = z.infer<typeof ConversationChannelSchema>

/**
 * 下游 F1-F4（分类 / 退订检测 / offerings / 渠道分发 / verifier / agent-core）
 * 会用这几个字段反查 `conversations` / `conversation_messages`，所以这里只带
 * 「查得到全部上下文所需的最小集」，不把整条消息正文重复搬一份进事件——
 * 正文的事实来源永远是数据库，事件只负责「告诉你去哪一行查」。
 */
export const ConversationMessageReceivedSchema = z.object({
  channel: ConversationChannelSchema,
  client_id: z.string().min(1),
  /** conversations.id（UUID）——下游按这个查整条对话，不是按 conversations.conversation_id 那个渠道自己的线程键。 */
  conversation_id: z.string().min(1),
  /** conversation_messages.message_id（渠道自己的消息 id，例如 Meta 的 mid.xxx）。 */
  message_id: z.string().min(1),
  /** 归属的真人；还没合并到任何人时为 null——下游据此决定要不要跳过需要联系方式的步骤。 */
  contact_id: z.string().nullable(),
  direction: z.enum(['inbound', 'outbound']),
  sent_at: z.string().min(1),
})
export type ConversationMessageReceivedData = z.infer<typeof ConversationMessageReceivedSchema>
