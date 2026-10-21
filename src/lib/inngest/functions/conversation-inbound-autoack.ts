/**
 * Magic Engine 2.0 · Inngest 云端消费者：F1 自动安抚回复（issue #1584）
 *
 * 客户消息（Messenger/WhatsApp，事件渠道无关）进来之后，在任何人工审核 /
 * AI 起草介入之前，先发一条硬编码的安抚话术——同时也是打开 WhatsApp 72 小时
 * 免费窗口的关键动作（见 issue #1290 评论区 2026-09-02 补记：24 小时内不回，
 * WhatsApp 免费窗口根本不开）。
 *
 * 🔴 **本文件的模板绝不读 canonical / 知识库 / 任何客户事实**（v3 方案
 *    `~/.claude/plans/cts-tours-messenger-dynamic-pearl.md` §9.14 C.5，
 *    2026-09-14 对 issue #1584 原描述的正式纠正）。issue #1584 的原文写的是
 *    「模板从 canonical.factual_bullets 带出」——**那个说法已作废**。§9.14 C.5
 *    的原话：「F1 是唯一不经人工审核直接自动发送的路径，绝不能读
 *    `getClientKnowledge`/任何知识条目，否则一旦知识库里有未经客户确认的
 *    敏感事实，等于绕过双签闸自动说出去」。本文件因此：
 *      · 不 import `@/lib/knowledge/read`（`getClientKnowledge`）；
 *      · 不 import 任何 `canonical.*` / offerings 相关模块；
 *      · `AUTOACK_TEMPLATE` 是写死在这个文件里的常量字符串，只有英文（PM 2026-10-21：
 *        自动回复不可以出现中文）、零客户专属事实（没有团名、价格、电话、日期）。
 *    改这个模板前必须重新走一次子牙+魏征复审，不是这个文件内部能拍板的事。
 *
 * ## 五道闸（issue #1584 骨架）
 *
 *   Step 0   opt-out 检查（#1575 `isConversationOptedOut`，fail-closed）
 *   Step 0.5 渠道 kill switch（#1578 `isChannelEnabled`，fail-closed）
 *   （2026-10-22 PM：售前/售后分类这一道闸已拿掉——所有 WhatsApp / 私信进线都发安抚，
 *     不再因为「看起来像老客户」跳过。原因见台账 2026-10-22-ai-reply-all-inbound-no-postsale-gate。）
 *   Step 1   发硬编码模板（#1578 `CHANNEL_SEND`）
 *   Step 2   emit `conversation/autoack.sent` 收尾事件
 *
 * 每一步各自一个 `step.run`（跟 `messenger-brief-after-sync.ts` 同一个理由：
 * 副作用必须在 step 里才会被 Inngest 缓存——`retries: 1` 时如果 Step 2 的
 * emit 失败重试，Step 1 的发送结果已经被 memoize，不会被同一次重放重发一遍）。
 *
 * ## 谁决定「这个客户该用哪份售后判据」——不写死 CTS
 *
 * `classifyConversation` 本身不带任何行业默认值（见 classify.ts 文件头），
 * 旅游行业的 `TOURISM_POST_SALE_POLICY` 是一个具名 Playbook 常量。本文件
 * 按 `clients.industry` 走跟 `industry-features.ts` 完全一样的「行业关键词
 * 匹配」路子选 policy（`resolvePostSaleClassificationPolicy`），不是
 * `if (clientId === CTS_ID)`——明天换成另一个旅游客户，这段代码不需要改。
 * 认不出行业 → 没有 Playbook 可用 → 直接按 `lead_intake` 处理（跟
 * `classifyConversation` 自己「查不到消息就保守判 lead_intake」的方向一致，
 * 不是「换了行业就不发」）。
 *
 * ## 一事件一主
 *
 * `conversation/message.received`（触发）和 `conversation/autoack.sent`
 * （产出）都不在 `WORKER_OWNED_EVENTS` 里——本机 factory-worker 不消费，
 * 契约测试锁死（见本文件测试）。
 */

import { randomUUID } from 'node:crypto'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import {
  CONVERSATION_MESSAGE_RECEIVED_EVENT,
  ConversationMessageReceivedSchema,
  type ConversationMessageReceivedData,
} from '@/lib/conversations/events'
import { isConversationOptedOut } from '@/lib/messenger-agent/optout'
import {
  isChannelEnabled,
  CHANNEL_SEND,
  getSentMessageId,
  type MessengerAgentChannel,
  type ChannelSendResult,
} from '@/lib/messenger-agent/channel-dispatch'
import {
  TOURISM_POST_SALE_POLICY,
  type PostSaleClassificationPolicy,
} from '@/lib/messenger-agent/classify'
import { hasIndustryFeature } from '@/lib/clients/industry-features'
import { AUTOACK_SENT_BY_EMAIL, AUTOACK_TEMPLATE } from '@/lib/messenger/autoack-identity'
import { hasRecentOutbound } from '@/lib/messenger/recent-outbound'

export const CONVERSATION_AUTOACK_SENT_EVENT = 'conversation/autoack.sent'

/**
 * ⚠️ 系统身份，不是真人邮箱。`sendReply`/`sendWhatsApp` 的 `sentByEmail` 字段
 * 现有全部调用方（`messenger/conversations/[id]/reply` 路由、
 * `messaging/adapters/*`）都是「登录用户手点发送」，全仓 grep 确认没有既有的
 * 自动化发信身份约定可复用。这里显式钉一个可识别的系统身份，方便日后审计
 * `conversation_outbound_log` 时一眼看出这条是 F1 自动发的，不是某个真人
 * 账号发的——这是本次实现里唯一没有现成约定可抄、需要自己定的判断，已在
 * PR 描述里留痕给复审看。
 */
export { AUTOACK_SENT_BY_EMAIL }

/**
 * 🔴 硬编码、双语、零客户专属事实——见文件头 §9.14 C.5 说明。
 * 不含团名/价格/电话/日期，任何行业、任何客户都能收到这条而不会说错话。
 */
export { AUTOACK_TEMPLATE }

/** 同一会话最多每 6 小时自动安抚一次；6 小时内已有任何成功出站（含人工回复）则不发。 */
export const AUTOACK_COOLDOWN_HOURS = 6

export type AutoAckOutcome =
  | 'sent'
  | 'skipped_opted_out'
  | 'skipped_channel_disabled'
  | 'skipped_recently_replied'
  | 'skipped_invalid_payload'
  | 'send_failed'

export interface AutoAckReceipt {
  readonly outcome: AutoAckOutcome
  readonly conversation_id: string | null
  readonly client_id: string | null
  readonly channel: string | null
  readonly detail: string | null
}

export type ParsedMessageReceived =
  | { readonly ok: true; readonly value: ConversationMessageReceivedData }
  | { readonly ok: false; readonly reason: string }

/**
 * payload 校验，抽出来供直测。复用 webhook 那份共享 Zod 契约
 * （`@/lib/conversations/events.ts`），不重复定义形状——那份契约的头注释
 * 明确说 Messenger/WhatsApp 两条 webhook 靠同一个事件名 + `data.channel`
 * 区分渠道，F1/F2/F3/F4 都该按这份契约读，不是各自再定义一份。
 */
export function parseMessageReceived(raw: unknown): ParsedMessageReceived {
  const parsed = ConversationMessageReceivedSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid_payload' }
  }
  return { ok: true, value: parsed.data }
}

/**
 * F1 只认 messenger/whatsapp——邮件（issue #1745）故意不接进来：F1 是"客户消息
 * 进来几秒内自动发一句安抚话术"，价值建立在 webhook 实时触达上；邮件靠每小时
 * 同步，秒回的安抚话术对邮件没有对应的产品价值，这是业务判断，不是本次改动能
 * 替 PM 拍板的事（留给 PM/华佗从业务角度决定要不要做邮件版安抚）。`voice` 同样
 * 不认——事件契约的 channel 枚举比 F1 支持的渠道范围更宽，F1 只处理其中一部分，
 * 其余渠道按"payload 认不出"处理，不猜、不硬转。
 *
 * F2（`conversation-inbound-draft.ts`）复用这个函数判断"这个渠道要不要等 F1
 * 先送达"，两处判断必须是同一份真相——不是各自维护一份渠道白名单。
 */
export function isKnownAutoAckChannel(channel: string): channel is MessengerAgentChannel {
  return channel === 'messenger' || channel === 'whatsapp'
}

/**
 * 这个客户该用哪份售后判据——按行业关键词匹配（跟
 * `industryFeatureFlags`/`hasIndustryFeature` 同一套判法），不是按
 * `clientId` 硬编码。目前只有旅游行业有具名 Playbook；其它行业没有对应
 * 判据时返回 `null`，调用方按 `lead_intake` 处理（不猜、不套错行业的判据）。
 */
export function resolvePostSaleClassificationPolicy(
  industry: string | null | undefined,
): PostSaleClassificationPolicy | null {
  if (hasIndustryFeature(industry, 'tailor_made')) return TOURISM_POST_SALE_POLICY
  return null
}

/**
 * 返回类型用三渠道合并的 `ChannelSendResult`（不是只有 messenger/whatsapp 的
 * 两渠道联合类型），因为 `deps.send` 的类型是 `Record<MessengerAgentChannel,
 * ChannelSendFn>`——`MessengerAgentChannel` 三个成员都要有一个类型兼容的值，
 * 哪怕 F1 运行时从不会真的调 `send.email`（`isKnownAutoAckChannel` 在那之前
 * 就已经 return 了，见文件头/该函数注释）。
 */
type ChannelSendFn = (input: {
  clientId: string
  conversationId: string
  body: string
  sentByEmail: string
  usedAiDraft: boolean
}) => Promise<ChannelSendResult>

export interface ConversationInboundAutoAckDeps {
  isOptedOut: (conversationId: string) => Promise<boolean>
  isEnabled: (clientId: string, channel: string) => Promise<boolean>
  hasRecentOutbound: (conversationId: string, sinceIso: string) => Promise<boolean>
  send: Record<MessengerAgentChannel, ChannelSendFn>
}

/** 依赖注入版：单测直接注入假的 opt-out/kill-switch/send，不碰真数据库、不真发消息。 */
export function createConversationInboundAutoAckFunction(deps: ConversationInboundAutoAckDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}conversation-inbound-autoack`,
      name: 'Governed Reply — F1 auto-acknowledgement',
      retries: 1,
      // v3 补丁#2：Meta 的 webhook 是至少一次投递，客人连发几条消息也会拆成
      // 几个独立事件——30 秒内合并成一次安抚，不是每条消息各回一遍。
      // 这只是"合并一波连发"；跨波次的重复由下面的 6 小时限频
      // （`check-recent-outbound`）兜住。
      debounce: { period: '30s', key: 'event.data.conversation_id' },
    },
    { event: CONVERSATION_MESSAGE_RECEIVED_EVENT },
    async ({ event, step }): Promise<AutoAckReceipt> => {
      const parsed = parseMessageReceived(event.data)
      if (!parsed.ok) {
        return {
          outcome: 'skipped_invalid_payload',
          conversation_id: null,
          client_id: null,
          channel: null,
          detail: parsed.reason,
        }
      }

      const { client_id, conversation_id, channel, direction } = parsed.value
      const base = { conversation_id, client_id, channel } as const

      // 只处理客户发进来的消息——我们自己发出去的消息如果也走这个事件名，
      // 不该触发一次「自动安抚」回自己。
      if (direction !== 'inbound') {
        return { ...base, outcome: 'skipped_invalid_payload', detail: `not_inbound:${direction}` }
      }

      // F1/F2 目前只认 messenger/whatsapp——事件契约的 channel 枚举还含
      // email/voice（其它渠道复用同一套 conversations 表），那两个不归这条
      // 自动安抚管，按「payload 认不出」处理，不猜、不硬转。
      if (!isKnownAutoAckChannel(channel)) {
        return { ...base, outcome: 'skipped_invalid_payload', detail: `unsupported_channel:${channel}` }
      }

      // Step 0：opt-out 检查（fail-closed，见 optout.ts 文件头「出错时宁可拦
      // 一条，不放过一条」）。
      //
      // 🔴 判断记录（要不要额外挂一条 pm-todo）：一个已经标记拒联的联系人又
      // 发消息进来，理论上是"可能想解除拒联"的信号，但这里刻意不新建一个
      // pm-todo 条目——`pm-todo/manual-items.ts` 现有的 push*Items 都是"定时
      // 任务扫已落库状态"的读时聚合模式，不是"事件到达就实时写一条"；这条对话
      // 本身仍然正常出现在 CRM 收件箱里（拒联状态本来就在联系人资料上可见），
      // 员工翻收件箱时天然会看到，不缺一个额外的提醒入口。真要做"拒联后又发
      // 消息"专属提醒，应该是 `manual-items.ts` 里新增一种 `ManualItemKind`
      // 的独立改动（有自己的 what/how/href 设计），不该顺手塞进这个函数——
      // 留白，不是漏做。
      const optedOut = await step.run('check-opt-out', () => deps.isOptedOut(conversation_id))
      if (optedOut) {
        return { ...base, outcome: 'skipped_opted_out', detail: null }
      }

      // Step 0.5：渠道 kill switch（fail-closed，见 channel-dispatch.ts 文件头）。
      // 这是 ME/PM 自己按下的开关，不是异常状态，不需要提醒任何人。
      const enabled = await step.run('check-channel-enabled', () => deps.isEnabled(client_id, channel))
      if (!enabled) {
        return { ...base, outcome: 'skipped_channel_disabled', detail: null }
      }

      // Step 0.6：6 小时限频——同一会话 6 小时内已有任何成功出站（自动安抚 /
      // 员工回复 / 人工批准的 AI 草稿）就不再发。读失败必须抛出去让 Inngest
      // 重试，绝不能把"读不出来"当成"最近没回过"而多发一条。
      const recentlyReplied = await step.run('check-recent-outbound', () => {
        const sinceIso = new Date(Date.now() - AUTOACK_COOLDOWN_HOURS * 3_600_000).toISOString()
        return deps.hasRecentOutbound(conversation_id, sinceIso)
      })
      if (recentlyReplied) {
        return { ...base, outcome: 'skipped_recently_replied', detail: `within_${AUTOACK_COOLDOWN_HOURS}h` }
      }

      // Step 1：发硬编码模板。不调 Claude，不占 verifier，不读任何知识源
      // （见文件头 §9.14 C.5）。
      const sendResult = await step.run('send-autoack', () =>
        deps.send[channel]({
          clientId: client_id,
          conversationId: conversation_id,
          body: AUTOACK_TEMPLATE,
          sentByEmail: AUTOACK_SENT_BY_EMAIL,
          usedAiDraft: false,
        }),
      )
      if (!sendResult.ok) {
        // 🔴 Codex 复审（2026-09-15，PR #1736）实测发现：这里原来把发送失败
        // 一律当成一个正常的函数返回值——但 `retries: 1` 只对"函数整体抛出异常"
        // 生效,一个正常 return 不会触发重试。结果是 Meta 一次瞬时网络/5xx
        // 故障（`status: 502` / `reason: 'graph_failed'`）会让这条安抚永久
        // 丢失、没有任何重试、也没有任何人工接力,只留在这次运行的返回值里。
        // 区分「重试可能有用」跟「重试没用」两种失败：502/graph_failed 是
        // provider 侧的瞬时故障，throw 出去让 Inngest 的 retries 接住；其余
        // （400/403/404/409/424，都是"这条消息/这个客户/这个渠道本身就不该
        // 发"的确定性失败）重试不会变好，维持原来 return 的终态。
        if (sendResult.status === 502) {
          throw new Error(
            `[conversation-inbound-autoack] 发送安抚话失败（provider 侧瞬时故障，等重试）：${sendResult.reason}`,
          )
        }
        return { ...base, outcome: 'send_failed', detail: sendResult.reason }
      }

      // Step 2：emit 收尾事件。id 用事件本身的稳定 id（重放/重试不变）拼会话
      // id 保证幂等；本地直接触发等没有 event.id 的场景才退化成随机值。
      //
      // 🔴 魏征复审（2026-09-15）实测发现：这里原来把 `step.sendEvent` 嵌套
      // 在 `step.run` 里面——Inngest SDK 自己会检测这种嵌套并发
      // `NESTING_STEPS` 警告（`components/execution/v2.js` 的
      // `executingStep` 检查），而且嵌套之后这个 step 自己的幂等哈希在原始
      // 执行和重试之间可能对不上，等于没有真的达到代码注释原来声称的"幂等"
      // 效果。改成跟仓库其它 Inngest 函数（`web-intelligence.ts` 等）一致的
      // 写法：`step.sendEvent` 直接顶层调用，不裹进 `step.run`。
      // 🔴 Codex 复审（2026-09-15，PR #1736）实测发现：这里原来发出的完成事件
      // 只有 client/conversation/channel，丢了 `CHANNEL_SEND` 结果里本来就有
      // 的 provider message id（`getSentMessageId`）——同一个会话可能有多次
      // 出站，下游没法把"完成"事件精确对应到这一次具体是哪条 provider 回执
      // （甚至 provider 侧返回空 id 时，事件也照样说"发成功了"）。补上触发
      // 消息 id + provider message id，让下游能真的按这个事件去核对回执。
      await step.sendEvent('autoack-sent', {
        id: `autoack:${conversation_id}:${event.id ?? randomUUID()}`,
        name: CONVERSATION_AUTOACK_SENT_EVENT,
        data: {
          client_id,
          conversation_id,
          channel,
          trigger_message_id: parsed.value.message_id,
          provider_message_id: getSentMessageId(channel, sendResult),
        },
      })

      return { ...base, outcome: 'sent', detail: null }
    },
  )
}

/** 生产实例。 */
export const conversationInboundAutoAck = createConversationInboundAutoAckFunction({
  isOptedOut: isConversationOptedOut,
  isEnabled: isChannelEnabled,
  hasRecentOutbound,
  send: CHANNEL_SEND,
})
