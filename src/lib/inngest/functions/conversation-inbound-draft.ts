/**
 * Magic Engine 2.0 · Inngest 云端消费者：F2 AI 起草回复主函数（issue #1585）
 *
 * 客户消息进来 → 分类/退订/开关三项独立判断 → 等 F1 安抚话术先送达（纯排序）→
 * 读事实层 + 对话历史 → Claude 起草 → 过 CTS 七道 Verifier 闸 → 存草稿 →
 * 等人工在门户批准（最长 4 小时）→ 批准后再查一次开关/窗口 → 真正发送。
 *
 * v3 方案（`~/.claude/plans/cts-tours-messenger-dynamic-pearl.md` §Layer4 F2）
 * 的九步骨架，逐步对应本文件的 step id：
 *
 *   check-opt-out / check-channel-enabled / classify-conversation
 *     —— 三项独立判断，互不依赖，任一命中直接 return（不靠"等 F1 事件"来判断
 *        "要不要继续"，这正是 3 审第 1 轮子牙 B1 blocker 修好的地方）
 *   wait-autoack —— 等 `conversation/autoack.sent`，纯 UX 排序（超时也继续，
 *        不是 gate，见下方 waitForEvent 调用处注释）
 *   load-context —— brief + 客户知识库 + 品牌红线 + 最近 5 条消息
 *   draft —— `callClaudeWithTools` 起草，agent 输出契约見
 *        `agent-output-schema.ts`（issue #1580）
 *   verify —— `verifier/policies/cts.ts` 七道闸（issue #1579）
 *   persist-draft(-error) —— 写 `conversation_reply_drafts`，upsert 幂等
 *        （UNIQUE (conversation_id, message_id_trigger)）
 *   await-approval —— `step.waitForEvent('conversation/reply.approved', { if:
 *        'async.data.draft_id == "${draftId}"' })`——**必须用 if 表达式**，不是
 *        `match: 'data.draft_id'`（外层批准事件不天然带 draft_id，v3 补丁#7，
 *        子牙 A6 实测指出旧写法语法错误）。这个 if 表达式的字面量已经被 F3
 *        （issue #1586，`conversation-approval-emit.ts`）的单测锁死为消费端契约，
 *        改这里的事件名/字段名前必须先跟 F3 对齐。
 *   send —— 再查一次 kill switch + 窗口，defensive 重读当前 `draft_body`
 *        （可能被人工"改后发送"覆盖过，见下方"改后发送"小节）+ 长度硬校验，
 *        再走 `CHANNEL_SEND[channel]`
 *
 * ## 为什么"起草失败"不 throw（不靠 Inngest retry）
 *
 * `callClaudeWithTools` 不是幂等操作——重试一次就是重新花一次 Claude 的钱、
 * 且可能生成完全不同的文案。🔴 子牙+魏征复审同时指出：`retries` 是**函数级**
 * 配置（跟 `[[reference-inngest-retries-is-function-level-only]]` 那次
 * Creatomate 事故同一个坑），如果 try/catch 包在 `step.run('draft', ...)`
 * **外面**，`step.run` 回调内部抛出的错误会先被 Inngest SDK 按函数级
 * `retries: 2` 重试这一步（重试耗尽才会把异常 reject 到外层 await 处），Claude
 * 实际会被调最多 3 次——这正是文件头这段话要避免的事，只在注释里声明是不够的。
 * 所以这里的 try/catch **必须包在 `step.run` 回调内部**：让这一步永远返回一个
 * 判别式结果（`{ ok, output }` / `{ ok: false, error }`），`step.run` 本身
 * 从不抛出，Inngest 因此永远不会对这一步做函数级重试。起草失败时本函数把它当作
 * 一个正常的终态处理（落一条 `verifier_status='error'` 的草稿行 + 返回
 * `draft_error`），那条 `retries: 2` 配置留给"分类/开关/发送"这类数据库瞬时
 * 故障用。
 *
 * ## "改后发送"跳过七道闸——已知残余风险，本轮只堵住其中一条
 *
 * F3 复审交接（issue #1585 评论区，2026-09-15）：门户"改后发送"
 * (`edit_and_approve`) 只做非空 + 1800 字符两条机械校验，其余六道闸（品牌红线/
 * 停售团提及/数字核实/话题禁区/provenance/URL 白名单）完全不重跑——人工批准
 * 本身是这条路径唯一的安全网。本文件在 Step `send` 真正发送前重新从数据库读
 * 一次当前 `draft_body`（不是复用内存里 Step `draft` 时的
 * `agentOutput.reply_text`），并对这个最终发送文本再做一次防御性长度硬校验——
 * **这只是把 F3 已经做过的长度校验在 F2 侧再确认一遍（防绕过 F3 路由直接改库），
 * 不等于重跑了六道内容闸**。🔴 子牙复审明确指出：品牌红线/停售团提及/话题禁区/
 * URL 白名单这四道只需要文本 + `brandRedlinePhrases` + `knowledge`，技术上可以
 * 在 Step send 前重跑；本轮没有做，是刻意留白（PM 2026-09-15 拍板本轮只做上线
 * 必需项，不做范围外加固），残余风险是：FDE 手打一段提到已停售团 / 命中品牌红线
 * 词 / 贴了非白名单链接的编辑文案，会不经任何内容校验直接发给客户。这条风险需要
 * 单独开 issue 跟踪，不能假装已经解决。
 *
 * ## Messenger `human_agent` 窗口 + AI 起草内容的标签风险（已知，未处理）
 *
 * `messagingWindow()`（`src/lib/messenger/send.ts`）的 24h-7d 区间会用
 * `MESSAGE_TAG: HUMAN_AGENT` 发送——这个标签的 Meta 平台语义是"真人客服在窗口内
 * 回复"，而这里发的是 AI 起草、人工批准的内容。人确实批准过，但"批准"和"标签
 * 声明的真人撰写"是否等价，属于产品/合规判断，不是这段代码能替 PM 拍板的事。
 * H17"窗口剩 <30min 升级"的判断在这个 7 天窗口下基本不会触发（`msRemaining`
 * 是到 7 天整个窗口关闭为止，不是到 24 小时标准窗口结束），实际效果是 24 小时
 * 后批准的草稿会安静地用 HUMAN_AGENT 标签发出去。子牙复审已确认这是继承自
 * 既有 `send.ts` 的窗口模型（不是本 issue 新引入的行为），本轮不改这个模型，
 * 只如实记录：这是需要 PM 明确风险接受度的一条，不是技术选择题。
 *
 * ## F4 心跳消费的三个收尾事件；PM daily-todo 由 #1589 消费，不在本文件重复
 *
 * `conversation/reply.blocked` / `conversation/reply.send_failed` /
 * `conversation/reply.timeout` 三个事件本 issue 负责 emit 出来，具体告警阈值/
 * 消费方是 F4（`conversation.health.heartbeat`，另开 issue）的范围。人工待办
 * 展示走 issue #1589（`src/lib/pm-todo/messenger-draft-items.ts`，PR #1747，
 * 动笔时未合并）——那份实现直接读 `conversation_reply_drafts.verifier_status`
 * 聚合成待批准/已批但发送失败(P0)/超时升级三档待办，本文件只需要保证写对
 * `verifier_status`，不需要（也不应该）在这里再调用 `pm-todo/manual-items.ts`
 * 重复推一次——两边合并顺序不影响这个契约，`verifier_status` 的取值集合早已由
 * migration 的 CHECK 约束钉死。
 *
 * ## 一事件一主
 *
 * 触发事件 `conversation/message.received` 和本文件产出的六个事件（含等待中的
 * autoack.sent/reply.approved）都不在 `WORKER_OWNED_EVENTS` 里——本机
 * factory-worker 不消费，见本文件测试里的契约断言。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import {
  CONVERSATION_MESSAGE_RECEIVED_EVENT,
  CONVERSATION_AUTOACK_SENT_EVENT,
  CONVERSATION_REPLY_APPROVED_EVENT,
  ConversationMessageReceivedSchema,
  type ConversationMessageReceivedData,
} from '@/lib/conversations/events'
import { isConversationOptedOut } from '@/lib/messenger-agent/optout'
import {
  isChannelEnabled,
  CHANNEL_SEND,
  CHANNEL_WINDOW,
  isWindowClosed,
  type MessengerAgentChannel,
} from '@/lib/messenger-agent/channel-dispatch'
import {
  classifyConversation,
  resolvePostSaleClassificationPolicy,
  type ConversationClass,
  type PostSaleClassificationPolicy,
} from '@/lib/messenger-agent/classify'
import { buildMessengerAgentSystemPrompt } from '@/lib/messenger-agent/prompt'
import { buildMessengerAgentTools, CUSTOMER_FACING_SENSITIVITIES } from '@/lib/messenger-agent/tools'
import { callClaudeWithTools } from '@/lib/anthropic/client'
import { MessengerAgentOutputSchema, type MessengerAgentOutput } from '@/lib/messenger-agent/agent-output-schema'
import { resolveVerifierPolicy } from '@/lib/messenger-agent/verifier/policies'
import type { VerifierResult } from '@/lib/messenger-agent/verifier/framework'
import type { KnowledgeReadResult, KnowledgeEntry } from '@/lib/knowledge'
import type { SendReplyResult } from '@/lib/messenger/send'
import type { SendWhatsAppResult } from '@/lib/whatsapp/send'
import {
  loadDraftContext,
  persistDraft,
  updateDraftStatus,
  markTimedOutIfPending,
  loadApprovedDraft,
  loadLastInboundAt,
  type LoadedDraftContext,
  type PersistDraftInput,
  type ApprovedDraftRow,
} from './conversation-inbound-draft-store'

export const CONVERSATION_REPLY_BLOCKED_EVENT = 'conversation/reply.blocked'
export const CONVERSATION_REPLY_SEND_FAILED_EVENT = 'conversation/reply.send_failed'
export const CONVERSATION_REPLY_TIMEOUT_EVENT = 'conversation/reply.timeout'

/**
 * F1（issue #1584，`conversation-inbound-autoack.ts`，PR #1739）在本文件动笔时
 * 是未合并的开着的 PR，跟这里共用的系统身份常量还没有一个已合并的家可以 import——
 * 这个值本身已跟 F1 逐字核对一致（子牙复审）。可对照的两个事件名常量和
 * `resolvePostSaleClassificationPolicy` 已经改成从已合并的 `conversations/events.ts`
 * / `messenger-agent/classify.ts` import（见上方 import 段），不再本地重复声明。
 */
export const DRAFT_SENT_BY_EMAIL = 'governed-reply-agent@magicengine.cloud'

/** 跟 F3 route.ts 的 `MAX_EDITED_BODY_LENGTH` 同一个数字——两个渠道里更严格的那个上限。
 *  Step `send` 前的防御性硬校验用同一个常量,见文件头"改后发送"说明。 */
const MAX_APPROVED_BODY_LENGTH = 1800

/** 窗口剩余不足半小时就不再发送、转人工升级——v3 方案 H17。 */
const WINDOW_CLOSING_SOON_MS = 30 * 60 * 1000

export type DraftOutcome =
  | 'sent'
  | 'skipped_invalid_payload'
  | 'skipped_opted_out'
  | 'skipped_channel_disabled'
  | 'skipped_post_sale'
  | 'draft_error'
  | 'blocked'
  | 'timed_out'
  | 'send_failed'

export interface DraftReceipt {
  readonly outcome: DraftOutcome
  readonly conversation_id: string | null
  readonly client_id: string | null
  readonly channel: string | null
  readonly draft_id: string | null
  readonly detail: string | null
}

export type ParsedMessageReceived =
  | { readonly ok: true; readonly value: ConversationMessageReceivedData }
  | { readonly ok: false; readonly reason: string }

/** 复用 F1 同一份共享 Zod 契约——两函数订阅同一个事件名,不能各写各的解析逻辑。 */
export function parseMessageReceived(raw: unknown): ParsedMessageReceived {
  const parsed = ConversationMessageReceivedSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid_payload' }
  }
  return { ok: true, value: parsed.data }
}

function isKnownDraftChannel(channel: string): channel is MessengerAgentChannel {
  return channel === 'messenger' || channel === 'whatsapp'
}

// ---------------------------------------------------------------------------
// draft（Layer 2 · Claude 起草）—— load-context / persist-draft 的存储实现见
// `./conversation-inbound-draft-store.ts`（保持本文件 < 800 行）。
// ---------------------------------------------------------------------------

/**
 * Claude 偶尔会无视"不要输出 JSON 之外的文字"这条硬性规则,包一层 ```json
 * 代码块——防御性剥掉,不是纵容它违反契约,失败了照样按 `draft_error` 处理。
 */
export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

/**
 * 魏征复审（issue #1591 dry-run，2026-09-16）实测：CTS 真实客户消息 30 条里有
 * 8 条（26.7%）触发了这个真问题——Claude 偶尔会在纯 JSON 前面多包一层解释性
 * 文字（"客户最新一条消息是…"/"The facts …"），`stripMarkdownFence` 只处理
 * 整段被 ``` 包住的情况，处理不了"前面多一句话"这种——直接 `JSON.parse` 炸,
 * 落进 `draft_error`。这里在直接解析失败后，从文本里找第一个 `{` 开始，用
 * 感知字符串的括号计数扫到匹配的 `}`，把中间这段当 JSON 再试一次——不是纵容
 * AI 不守契约，只是不让"多说了一句话"这种可恢复的输出白白变成需要人工介入
 * 的 `error` 态。真的找不到平衡的 JSON 片段（或提取出来的东西也解析不了）,
 * 原样把第一次 `JSON.parse` 的异常抛出去，跟改动前行为一致，不吞真的坏输出。
 */
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null // 括号没配平——不是这类"多包一层文字"的可恢复情况
}

/** `JSON.parse` 失败时的兜底：容忍前后多余文字，提取出被包住的那段 JSON 对象再试一次。 */
export function parseAgentJson(text: string): unknown {
  const stripped = stripMarkdownFence(text)
  try {
    return JSON.parse(stripped)
  } catch (originalError) {
    const extracted = extractBalancedJsonObject(stripped)
    if (extracted !== null) {
      try {
        return JSON.parse(extracted)
      } catch {
        // 提取出来的那段本身也不是合法 JSON——按原始错误处理，不吞真坏输出。
      }
    }
    throw originalError
  }
}

/** 生产实现：组装 prompt + 3 只读工具,起草一条回复,校验输出契约（issue #1580）。 */
async function runDraftAgent(
  clientId: string,
  conversationId: string,
  context: LoadedDraftContext,
): Promise<MessengerAgentOutput> {
  const customerFacingFacts: KnowledgeEntry[] = context.knowledge.entries.filter((e) =>
    CUSTOMER_FACING_SENSITIVITIES.has(e.sensitivity),
  )
  const brandFacts: KnowledgeEntry[] = context.knowledge.entries.filter((e) => e.sensitivity === 'general')

  const systemPrompt = buildMessengerAgentSystemPrompt({
    brief: context.brief,
    customerFacingFacts,
    brandFacts,
    conversationHistory: context.history,
  })
  const { tools, handlers } = buildMessengerAgentTools({ clientId, conversationId })

  const result = await callClaudeWithTools({
    systemPrompt,
    messages: [
      {
        role: 'user',
        content: '请针对客户最新一条消息起草回复，严格按系统提示里的 JSON 契约输出，不要输出契约之外的任何文字。',
      },
    ],
    tools,
    toolHandlers: handlers,
  })

  const rawJson = parseAgentJson(result.text)
  return MessengerAgentOutputSchema.parse(rawJson)
}

// ---------------------------------------------------------------------------
// verify（Layer 3）—— 按 clientId 查表分发到具体客户的 policy（查表本身住在
// `verifier/policies/index.ts`，编排层不认识任何具体客户，见该文件头注释——
// 子牙复审指出的 policy 层归属问题）
// ---------------------------------------------------------------------------

/**
 * fail-closed：查不到这个客户的 policy 就直接判 block,不是"没有闸门所以放行"。
 * MVP 只有 CTS 一个客户接了这条治理系统,其余客户理论上不会走到这个函数（F1/F2
 * 的 kill switch 默认 false），这里只是不假设调用方一定会先做这层保护。
 */
function verifyDraft(
  clientId: string,
  agentOutput: MessengerAgentOutput,
  brandRedlinePhrases: string[],
  knowledge: KnowledgeReadResult,
): VerifierResult {
  const verify = resolveVerifierPolicy(clientId)
  if (!verify) {
    return {
      ok: false,
      blocked_reasons: [`no_verifier_policy_for_client: ${clientId}`],
      require_human_confirm: true,
    }
  }
  return verify({ clientId, agentOutput, brandRedlinePhrases, knowledge })
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

type ChannelSendFn = (input: {
  clientId: string
  conversationId: string
  body: string
  sentByEmail: string
  usedAiDraft: boolean
}) => Promise<SendReplyResult | SendWhatsAppResult>

export interface ConversationInboundDraftDeps {
  isOptedOut: (conversationId: string) => Promise<boolean>
  isEnabled: (clientId: string, channel: string) => Promise<boolean>
  classify: (conversationId: string, policy: PostSaleClassificationPolicy) => Promise<ConversationClass>
  loadIndustry: (clientId: string) => Promise<string | null>
  loadContext: (clientId: string, conversationId: string) => Promise<LoadedDraftContext>
  runAgent: (clientId: string, conversationId: string, context: LoadedDraftContext) => Promise<MessengerAgentOutput>
  verify: (
    clientId: string,
    agentOutput: MessengerAgentOutput,
    brandRedlinePhrases: string[],
    knowledge: KnowledgeReadResult,
  ) => VerifierResult
  persistDraft: (input: PersistDraftInput) => Promise<{ id: string }>
  updateDraftStatus: (draftId: string, patch: Record<string, unknown>) => Promise<void>
  markTimedOutIfPending: (draftId: string) => Promise<boolean>
  loadApprovedDraft: (draftId: string) => Promise<ApprovedDraftRow | null>
  loadLastInboundAt: (conversationId: string) => Promise<string | null>
  send: Record<MessengerAgentChannel, ChannelSendFn>
}

/** 依赖注入版：单测直接注入假依赖，不碰真数据库、不真调 Claude、不真发消息。 */
export function createConversationInboundDraftFunction(deps: ConversationInboundDraftDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}conversation-inbound-draft`,
      name: 'Governed Reply — F2 AI draft main pipeline',
      retries: 2,
      concurrency: { limit: 1, key: 'event.data.conversation_id' },
      // v3 方案 H15：20 秒内多条消息合并成一次起草（原生 debounce）。
      debounce: { period: '20s', key: 'event.data.conversation_id' },
      // issue #1585「改动范围」逐字要求：同一条渠道消息（Meta webhook 未收到
      // 200 会重投，最长 24 小时）不应该在 debounce 窗口之外被当成一条新消息
      // 重新跑一遍起草——重新调用 Claude 既费钱又可能生成不同文案。
      idempotency: 'event.data.message_id',
    },
    { event: CONVERSATION_MESSAGE_RECEIVED_EVENT },
    async ({ event, step, runId }): Promise<DraftReceipt> => {
      const parsed = parseMessageReceived(event.data)
      if (!parsed.ok) {
        return {
          outcome: 'skipped_invalid_payload',
          conversation_id: null,
          client_id: null,
          channel: null,
          draft_id: null,
          detail: parsed.reason,
        }
      }

      const { client_id, conversation_id, message_id, channel, direction } = parsed.value
      const base = { conversation_id, client_id, channel, draft_id: null } as const

      if (direction !== 'inbound') {
        return { ...base, outcome: 'skipped_invalid_payload', detail: `not_inbound:${direction}` }
      }
      if (!isKnownDraftChannel(channel)) {
        return { ...base, outcome: 'skipped_invalid_payload', detail: `unsupported_channel:${channel}` }
      }

      // Step "kill-check" —— 三项独立判断，任一命中直接 return，不依赖 F1 是否
      // 执行成功、也不靠等 F1 的事件来判断"要不要继续"（3 审第 1 轮子牙 B1）。

      const optedOut = await step.run('check-opt-out', () => deps.isOptedOut(conversation_id))
      if (optedOut) {
        return { ...base, outcome: 'skipped_opted_out', detail: null }
      }

      const enabled = await step.run('check-channel-enabled', () => deps.isEnabled(client_id, channel))
      if (!enabled) {
        return { ...base, outcome: 'skipped_channel_disabled', detail: null }
      }

      const conversationClass = await step.run('classify-conversation', async () => {
        const industry = await deps.loadIndustry(client_id)
        const policy = resolvePostSaleClassificationPolicy(industry)
        return policy ? deps.classify(conversation_id, policy) : ('lead_intake' as ConversationClass)
      })
      if (conversationClass === 'post_sale') {
        return { ...base, outcome: 'skipped_post_sale', detail: null }
      }

      // Step "wait-autoack" —— 纯 UX 排序（确保安抚话术先送达），不是 gate：
      // 超时（F1 因为瞬时故障没能按时 emit）也继续往下走起草，不因为排序没保证
      // 就放弃这整段本该继续的自动回复流程。
      await step.waitForEvent('wait-autoack', {
        event: CONVERSATION_AUTOACK_SENT_EVENT,
        timeout: '5m',
        if: `async.data.conversation_id == "${conversation_id}"`,
      })

      const context = await step.run('load-context', () => deps.loadContext(client_id, conversation_id))

      // Step "draft" —— 起草失败不 throw（不靠 Inngest retry，见文件头说明）。
      // 🔴 try/catch 必须包在 step.run 回调**内部**：包在外面的话，回调里抛出的
      // 异常会先被 Inngest 按函数级 retries:2 重试这一步（重试耗尽才 reject 到
      // 外层），Claude 实际会被调最多 3 次——这正是"不靠 Inngest retry"要避免的
      // 事，只在注释里声明不算数（子牙+魏征复审同时指出）。让这一步永远返回一个
      // 判别式结果，step.run 本身从不抛出。
      const draftAttempt = await step.run('draft', async () => {
        try {
          return { ok: true as const, output: await deps.runAgent(client_id, conversation_id, context) }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      })

      if (!draftAttempt.ok) {
        const errorDraft = await step.run('persist-draft-error', () =>
          deps.persistDraft({
            clientId: client_id,
            conversationId: conversation_id,
            messageIdTrigger: message_id,
            channel,
            draftBody: '',
            agentConfidence: null,
            sourceOfferingCodes: [],
            quotedOfferingNames: [],
            verifierStatus: 'error',
            blockedReasons: [`agent_error: ${draftAttempt.error}`],
            verifierOutputJson: null,
            inngestRunId: runId,
          }),
        )
        return { ...base, outcome: 'draft_error', draft_id: errorDraft.id, detail: draftAttempt.error }
      }
      const draftedOutput: MessengerAgentOutput = draftAttempt.output

      // Step "verify"
      const verifierResult = await step.run('verify', () =>
        deps.verify(client_id, draftedOutput, context.brandRedlinePhrases, context.knowledge),
      )

      // Step "persist-draft"
      const draft = await step.run('persist-draft', () =>
        deps.persistDraft({
          clientId: client_id,
          conversationId: conversation_id,
          messageIdTrigger: message_id,
          channel,
          draftBody: draftedOutput.reply_text,
          agentConfidence: draftedOutput.confidence,
          sourceOfferingCodes: draftedOutput.offerings.map((o) => o.code),
          quotedOfferingNames: draftedOutput.offerings.map((o) => o.name),
          verifierStatus: verifierResult.ok ? 'pending' : 'blocked',
          blockedReasons: verifierResult.ok ? null : verifierResult.blocked_reasons,
          verifierOutputJson: verifierResult,
          inngestRunId: runId,
        }),
      )

      if (!verifierResult.ok) {
        await step.sendEvent('reply-blocked', {
          id: `reply-blocked:${draft.id}`,
          name: CONVERSATION_REPLY_BLOCKED_EVENT,
          data: {
            draft_id: draft.id,
            client_id,
            conversation_id,
            channel,
            blocked_reasons: verifierResult.blocked_reasons,
          },
        })
        return {
          ...base,
          outcome: 'blocked',
          draft_id: draft.id,
          detail: verifierResult.blocked_reasons.join('; '),
        }
      }

      // Step "await-approval" —— if 表达式模式，不是 match（v3 补丁#7）。
      const approvalEvent = await step.waitForEvent('await-approval', {
        event: CONVERSATION_REPLY_APPROVED_EVENT,
        timeout: '4h',
        if: `async.data.draft_id == "${draft.id}"`,
      })

      if (!approvalEvent) {
        // 只在草稿仍是 pending 时才真的算超时——见 markTimedOutIfPending 头注释
        // 的竞态说明（子牙+魏征复审）。0 行受影响 = 状态在这一刻已经被人工决定
        // 过（approved/rejected），不覆盖、也不发一次假的事故信号。
        const reallyTimedOut = await step.run('mark-timed-out-if-pending', () =>
          deps.markTimedOutIfPending(draft.id),
        )
        if (!reallyTimedOut) {
          // 🔴 魏征二轮复审 W1：0 行受影响只说明"不是 pending 了"，没说清是被
          // rejected（无需再管，人工已经处理完）还是被 approved（人工已经批准，
          // 但本次 run 到这里才发现——`approved` 不在 PR #1747 today 待办的
          // TRACKED_STATUSES 里，如果这里直接静默返回 timed_out，这条已经被
          // 批准的草稿会永远没人发、也没人知道要发）。查一次真实状态，approved
          // 就转成 send_failed 让它重新进人工待办可见范围，而不是让"已批准"
          // 静默卡死。
          const postTimeoutState = await step.run('load-post-timeout-status', () =>
            deps.loadApprovedDraft(draft.id),
          )
          if (postTimeoutState?.verifier_status === 'approved') {
            await step.run('mark-send-failed-approved-after-timeout', () =>
              deps.updateDraftStatus(draft.id, { verifier_status: 'send_failed' }),
            )
            await step.sendEvent('reply-send-failed-approved-after-timeout', {
              id: `reply-send-failed:${draft.id}:approved-after-timeout`,
              name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
              data: {
                draft_id: draft.id,
                client_id,
                conversation_id,
                channel,
                reason: 'approved_after_timeout',
              },
            })
            return { ...base, outcome: 'send_failed', draft_id: draft.id, detail: 'approved_after_timeout' }
          }
          return { ...base, outcome: 'timed_out', draft_id: draft.id, detail: 'already_decided_before_timeout' }
        }
        await step.sendEvent('reply-timeout', {
          id: `reply-timeout:${draft.id}`,
          name: CONVERSATION_REPLY_TIMEOUT_EVENT,
          data: { draft_id: draft.id, client_id, conversation_id, channel },
        })
        return { ...base, outcome: 'timed_out', draft_id: draft.id, detail: null }
      }

      // Step "send" —— 再查一次 opt-out（H1）+ kill switch + 窗口（H16/H17），
      // defensive 重读 draft_body（可能已被"改后发送"覆盖）+ 长度硬校验，才
      // 真正发送。

      // 🔴 子牙复审 H1：4 小时等待期间客户完全可能中途发一句"别再联系我"——
      // opt-out 跟 kill switch 是同一等级的 fail-closed 闸（F1 Step 0、F2
      // kill-check ①都在做这件事），Step send 只复查了 kill switch/窗口而漏了
      // 这一条,会给刚表示拒联的人发一条已经批准好的 AI 草稿。
      const stillOptedOut = await step.run('recheck-opt-out', () => deps.isOptedOut(conversation_id))
      if (stillOptedOut) {
        await step.run('mark-send-failed-opted-out', () =>
          deps.updateDraftStatus(draft.id, { verifier_status: 'send_failed' }),
        )
        await step.sendEvent('reply-send-failed-opted-out', {
          id: `reply-send-failed:${draft.id}:opted-out`,
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: { draft_id: draft.id, client_id, conversation_id, channel, reason: 'opted_out_during_approval' },
        })
        return { ...base, outcome: 'send_failed', draft_id: draft.id, detail: 'opted_out_during_approval' }
      }

      const stillEnabled = await step.run('recheck-channel-enabled', () => deps.isEnabled(client_id, channel))
      if (!stillEnabled) {
        await step.run('mark-send-failed-disabled', () =>
          deps.updateDraftStatus(draft.id, { verifier_status: 'send_failed' }),
        )
        await step.sendEvent('reply-send-failed-disabled', {
          id: `reply-send-failed:${draft.id}:disabled`,
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: { draft_id: draft.id, client_id, conversation_id, channel, reason: 'kill_switch_disabled_at_send' },
        })
        return { ...base, outcome: 'send_failed', draft_id: draft.id, detail: 'kill_switch_disabled_at_send' }
      }

      const lastInboundAt = await step.run('load-last-inbound-at', () => deps.loadLastInboundAt(conversation_id))
      const sendWindow = CHANNEL_WINDOW[channel](lastInboundAt)

      if (isWindowClosed(channel, sendWindow.kind)) {
        await step.run('mark-send-failed-window-closed', () =>
          deps.updateDraftStatus(draft.id, { verifier_status: 'send_failed' }),
        )
        await step.sendEvent('reply-send-failed-window-closed', {
          id: `reply-send-failed:${draft.id}:window-closed`,
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: { draft_id: draft.id, client_id, conversation_id, channel, reason: 'window_closed' },
        })
        return { ...base, outcome: 'send_failed', draft_id: draft.id, detail: 'window_closed' }
      }

      if (sendWindow.msRemaining < WINDOW_CLOSING_SOON_MS) {
        await step.run('mark-send-failed-window-closing', () =>
          deps.updateDraftStatus(draft.id, { verifier_status: 'send_failed' }),
        )
        await step.sendEvent('reply-send-failed-window-closing', {
          id: `reply-send-failed:${draft.id}:window-closing`,
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: { draft_id: draft.id, client_id, conversation_id, channel, reason: 'window_closing_soon' },
        })
        return { ...base, outcome: 'send_failed', draft_id: draft.id, detail: 'window_closing_soon' }
      }

      const approvedDraft = await step.run('load-approved-body', () => deps.loadApprovedDraft(draft.id))
      if (!approvedDraft || approvedDraft.verifier_status !== 'approved') {
        // 不应该发生（只有 F3 会把状态改成 approved，本函数自己是唯一后续写手），
        // 但发送这类有副作用的动作必须 fail-closed，不能假设内存里的状态还成立。
        await step.run('mark-send-failed-inconsistent', () =>
          deps.updateDraftStatus(draft.id, { verifier_status: 'send_failed' }),
        )
        await step.sendEvent('reply-send-failed-inconsistent', {
          id: `reply-send-failed:${draft.id}:inconsistent-state`,
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: { draft_id: draft.id, client_id, conversation_id, channel, reason: 'not_approved_at_send' },
        })
        return { ...base, outcome: 'send_failed', draft_id: draft.id, detail: 'not_approved_at_send' }
      }

      const finalBody = approvedDraft.draft_body
      if (finalBody.length > MAX_APPROVED_BODY_LENGTH) {
        // 防御性硬校验（F3 交接提醒#2）：不管这段文本是 AI 原始草稿还是人工编辑
        // 覆盖过的，发送前都不信任"人已经看过就一定没问题"。
        await step.run('mark-send-failed-too-long', () =>
          deps.updateDraftStatus(draft.id, { verifier_status: 'send_failed' }),
        )
        await step.sendEvent('reply-send-failed-too-long', {
          id: `reply-send-failed:${draft.id}:too-long`,
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: { draft_id: draft.id, client_id, conversation_id, channel, reason: 'body_exceeds_length_cap' },
        })
        return { ...base, outcome: 'send_failed', draft_id: draft.id, detail: 'body_exceeds_length_cap' }
      }

      const sendResult = await step.run('send', () =>
        deps.send[channel]({
          clientId: client_id,
          conversationId: conversation_id,
          body: finalBody,
          sentByEmail: DRAFT_SENT_BY_EMAIL,
          usedAiDraft: true,
        }),
      )

      if (!sendResult.ok) {
        // 跟 F1 同一个区分：provider 侧瞬时故障（502）throw 出去让 retries:2 接住，
        // 其余确定性失败（窗口/权限/客户不对等）维持原来 return 的终态。
        if (sendResult.status === 502) {
          throw new Error(`[conversation-inbound-draft] 发送失败（provider 侧瞬时故障，等重试）：${sendResult.reason}`)
        }
        await step.run('mark-send-failed', () => deps.updateDraftStatus(draft.id, { verifier_status: 'send_failed' }))
        await step.sendEvent('reply-send-failed', {
          id: `reply-send-failed:${draft.id}:provider-rejected`,
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: { draft_id: draft.id, client_id, conversation_id, channel, reason: sendResult.reason },
        })
        return { ...base, outcome: 'send_failed', draft_id: draft.id, detail: sendResult.reason }
      }

      await step.run('mark-sent', () => deps.updateDraftStatus(draft.id, { verifier_status: 'sent' }))
      return { ...base, outcome: 'sent', draft_id: draft.id, detail: null }
    },
  )
}

/** 生产实例。 */
export const conversationInboundDraft = createConversationInboundDraftFunction({
  isOptedOut: isConversationOptedOut,
  isEnabled: isChannelEnabled,
  classify: classifyConversation,
  loadIndustry: async (clientId: string) => {
    const { data, error } = await supabaseAdmin.from('clients').select('industry').eq('id', clientId).maybeSingle()
    if (error) {
      throw new Error(`[conversation-inbound-draft] 查客户行业失败 clientId=${clientId}: ${error.message}`)
    }
    return (data as { industry: string | null } | null)?.industry ?? null
  },
  loadContext: loadDraftContext,
  runAgent: runDraftAgent,
  verify: verifyDraft,
  persistDraft,
  updateDraftStatus,
  markTimedOutIfPending,
  loadApprovedDraft,
  loadLastInboundAt,
  send: CHANNEL_SEND,
})
