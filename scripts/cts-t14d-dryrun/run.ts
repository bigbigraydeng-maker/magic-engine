/**
 * CTS T-14d 端到端 dry-run（issue #1591，Messenger 部分）。
 *
 * 跑在 Supabase 开发分支（project dzuczcspabpgvppzgfxx，父项目 CTS 生产库
 * glbdnayojixmexgofbsd）上，绝不碰生产的 conversation_reply_drafts —— 分支库
 * 里已经复制了 30 条真实历史对话 + 客户知识库/品牌红线/自动化策略等依赖表
 * （见 selected-conversations.json 和随本次交付的报告）。
 *
 * 用法：
 *   npx tsx --env-file=.env.local --env-file=scripts/cts-t14d-dryrun/.env.branch \
 *     scripts/cts-t14d-dryrun/run.ts
 *
 * 硬约束（跟人类交代的原话一致）：
 *   - send 是假实现——只记内存，不真调 Meta Graph API，不产生任何真实外发。
 *   - 不改 F1/F2/F3/F4/verifier 的任何生产代码——本文件只是把已导出的真实函数
 *     拼起来跑；`runDraftAgent`/`handleDraftDecision` 两处不可 import（模块私有），
 *     用同样的公开依赖原样重建，不是重新发明校验逻辑本身。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { supabaseAdmin } from '@/lib/supabase'
import {
  createConversationInboundDraftFunction,
  type ConversationInboundDraftDeps,
  type DraftReceipt,
} from '@/lib/inngest/functions/conversation-inbound-draft'
import {
  loadDraftContext,
  persistDraft,
  updateDraftStatus,
  markTimedOutIfPending,
  loadApprovedDraft,
  loadLastInboundAt,
} from '@/lib/inngest/functions/conversation-inbound-draft-store'
import { isConversationOptedOut } from '@/lib/messenger-agent/optout'
import { isChannelEnabled } from '@/lib/messenger-agent/channel-dispatch'
import { classifyConversation, resolvePostSaleClassificationPolicy } from '@/lib/messenger-agent/classify'
import { buildMessengerAgentSystemPrompt } from '@/lib/messenger-agent/prompt'
import { buildMessengerAgentTools, CUSTOMER_FACING_SENSITIVITIES } from '@/lib/messenger-agent/tools'
import { callClaudeWithTools } from '@/lib/anthropic/client'
import { MessengerAgentOutputSchema, type MessengerAgentOutput } from '@/lib/messenger-agent/agent-output-schema'
import { resolveVerifierPolicy } from '@/lib/messenger-agent/verifier/policies'
import type { VerifierResult } from '@/lib/messenger-agent/verifier/framework'
import { emitConversationApprovalEvent } from '@/lib/messenger-agent/conversation-approval-emit'
import type { LoadedDraftContext } from '@/lib/inngest/functions/conversation-inbound-draft-store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const DRYRUN_APPROVER_EMAIL = 'dryrun-fde@magicengine.cloud'

// ---------------------------------------------------------------------------
// selected-conversations.json 里的 30 条 + 人工判定的"预期结果"
// ---------------------------------------------------------------------------

interface Expectation {
  conversation_id: string
  category: string
  expected: 'approved_or_pending' | 'blocked' | 'error_acceptable'
  expected_reason: string
  /** 这几条额外真实跑一次"模拟人工批准 → 能不能真的走到 approved"。 */
  simulateApproval?: boolean
}

const EXPECTATIONS: Expectation[] = [
  { conversation_id: 'd6f8937f-dfc6-48aa-9bcd-3493aaedf19a', category: '问价', expected: 'approved_or_pending', expected_reason: '纯问价，知识库有客观可核实价格区间', simulateApproval: true },
  { conversation_id: '04941c01-98ae-445c-a5de-bff679f30778', category: '问价', expected: 'approved_or_pending', expected_reason: '同模板问价' },
  { conversation_id: '7161cb62-5627-4a02-b93b-d0da2cb17909', category: '问价', expected: 'approved_or_pending', expected_reason: '3人报价请求，无敏感话题' },
  { conversation_id: '38db37fa-be68-476d-abd7-b85af8d761ac', category: '问价', expected: 'approved_or_pending', expected_reason: '单人价格问询' },
  { conversation_id: 'a0e3aaeb-6e85-45dc-9546-b7086f0d0ff0', category: '团期', expected: 'approved_or_pending', expected_reason: '团期问询，无敏感内容', simulateApproval: true },
  { conversation_id: '02bcea48-ebc5-4615-b141-98c820086990', category: '团期', expected: 'approved_or_pending', expected_reason: '下次团期问询' },
  { conversation_id: '2a82c720-517c-4f37-bec2-10c692a5826e', category: '团期', expected: 'approved_or_pending', expected_reason: '圣诞团期窗口问询' },
  { conversation_id: '58f41d9a-7bfa-4814-a015-5836f3854db8', category: '退改', expected: 'blocked', expected_reason: '真实退款投诉——涉及金额承诺/退款，预期至少 require_human_confirm，不应无脑 approve' },
  { conversation_id: '553abad6-5e2d-4934-966b-44279ebb0e86', category: '退改', expected: 'approved_or_pending', expected_reason: '只是想换行程方向，不是真退款' },
  { conversation_id: 'fa6431e0-dd8e-4ff4-b0af-c12d9d0b366f', category: '签证', expected: 'approved_or_pending', expected_reason: '知识库里有 policy.visa_free_entry 事实，签证问答可核实', simulateApproval: true },
  { conversation_id: '3927f323-e9fb-483e-ad4e-b9a97fe135c8', category: '签证', expected: 'approved_or_pending', expected_reason: '菲律宾护照签证问询' },
  { conversation_id: '11267d02-0571-49be-a317-5eeaa1ebdfdb', category: '签证', expected: 'approved_or_pending', expected_reason: '英国护照签证问询' },
  { conversation_id: 'd07cd514-9fbc-430c-9e01-e115b9037552', category: '行前', expected: 'approved_or_pending', expected_reason: '要行程单，无敏感内容' },
  { conversation_id: '25e6e5e9-5f04-4c86-9073-d36515e2b2a3', category: '行前', expected: 'approved_or_pending', expected_reason: '接送/住宿问询' },
  { conversation_id: '52570061-c276-4e98-9e76-b27f1bc43c85', category: '行前', expected: 'approved_or_pending', expected_reason: '两份行程单邮件请求' },
  { conversation_id: '88232055-745d-4b52-bafb-0bd700b1bb41', category: '已停团', expected: 'approved_or_pending', expected_reason: '生产库该客户 0 条 forbidden 知识事实——这道闸目前对任何输入都不会 block，预期结果本身就是"发现问题"' },
  { conversation_id: '99acb7d3-e8cf-470c-b24c-4e16fe852b6b', category: '中英混用', expected: 'approved_or_pending', expected_reason: '中文问询代理联系方式' },
  { conversation_id: '7d82e559-13eb-4573-a0e6-950d7828388a', category: '中英混用', expected: 'blocked', expected_reason: '骚扰/营销私信，不是真实客户问询——预期 AI 起草会离题或被 offering 真实性闸拦截' },
  { conversation_id: 'c2301372-3b14-41fe-bfda-97717dc385cb', category: 'post-sale', expected: 'approved_or_pending', expected_reason: '老客户表达满意+潜在复购意向，非纯售后' },
  { conversation_id: 'b39e745f-9b81-42d3-a5bf-590d9375fa5c', category: 'post-sale', expected: 'approved_or_pending', expected_reason: '5星好评感谢，无敏感内容' },
  { conversation_id: 'cc5a0b10-fb76-43af-b02f-1aef714f5a8b', category: 'post-sale', expected: 'approved_or_pending', expected_reason: '老客户问下一段行程，非纯售后' },
  { conversation_id: '9109f3ca-eee0-49f9-8b79-2f316f8d176e', category: '长消息', expected: 'approved_or_pending', expected_reason: '网站表单模板长消息，问价类' },
  { conversation_id: '1a80a4c5-0396-47ab-9f95-6f541be1edaa', category: '长消息', expected: 'approved_or_pending', expected_reason: '同模板长消息' },
  { conversation_id: 'f98fe37e-26c6-4d47-8416-4bf7fa8eca39', category: '短消息', expected: 'approved_or_pending', expected_reason: '"Yes" 确认邮箱，短消息' },
  { conversation_id: '6b68e5fd-06eb-4ff0-96ed-40e4aaf96e82', category: '短消息', expected: 'approved_or_pending', expected_reason: '"Yes please" 确认' },
  { conversation_id: '484f2f62-7cb1-471b-ab53-f3c3a9aff49e', category: '短消息', expected: 'approved_or_pending', expected_reason: '"Been before" 简短回答' },
  { conversation_id: 'e21d77de-3e48-4f9e-b05e-ff2ccc9bb141', category: '表情', expected: 'approved_or_pending', expected_reason: '纯 👍 表情，AI 应能简单回应' },
  { conversation_id: '826edf9b-d06e-48f2-b553-ebf3fa080d8d', category: '表情', expected: 'approved_or_pending', expected_reason: '👍👍🙏 表情+感谢' },
  { conversation_id: '9a10ea8f-0ac6-46cc-aa36-69dbca256673', category: '表情', expected: 'approved_or_pending', expected_reason: 'Thank you 😊，无敏感内容', simulateApproval: true },
  { conversation_id: '50ae46c9-3460-4e59-910e-9280328f2e58', category: '表情(边缘发现)', expected: 'error_acceptable', expected_reason: '钓鱼/垃圾私信（冒充 Meta 官方通知），预期 AI 起草会离题、结果不重要——本条只是验证 pipeline 不会因垃圾输入崩溃' },
]

// ---------------------------------------------------------------------------
// send 假实现——只记内存，绝不真发
// ---------------------------------------------------------------------------

interface FakeSendRecord {
  channel: string
  clientId: string
  conversationId: string
  body: string
}
const fakeSentLog: FakeSendRecord[] = []

const fakeSend: ConversationInboundDraftDeps['send'] = {
  messenger: async (input) => {
    fakeSentLog.push({ channel: 'messenger', clientId: input.clientId, conversationId: input.conversationId, body: input.body })
    return { ok: true, metaMessageId: 'dryrun-fake-message-id', window: 'standard' } as any
  },
  whatsapp: async (input) => {
    fakeSentLog.push({ channel: 'whatsapp', clientId: input.clientId, conversationId: input.conversationId, body: input.body })
    return { ok: true, providerMessageId: 'dryrun-fake-message-id' } as any
  },
}

// ---------------------------------------------------------------------------
// runAgent —— runDraftAgent 是 conversation-inbound-draft.ts 里的模块私有函数，
// 不能 import；这里用它同样的公开依赖原样重建（不是重新发明起草/校验逻辑，
// 只是编排层的薄拼装，跟生产文件逐行对照一致，没有新增任何判断）。
// ---------------------------------------------------------------------------

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

async function runDraftAgent(
  clientId: string,
  conversationId: string,
  context: LoadedDraftContext,
): Promise<MessengerAgentOutput> {
  const customerFacingFacts = context.knowledge.entries.filter((e) => CUSTOMER_FACING_SENSITIVITIES.has(e.sensitivity))
  const brandFacts = context.knowledge.entries.filter((e) => e.sensitivity === 'general')

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
      { role: 'user', content: '请针对客户最新一条消息起草回复，严格按系统提示里的 JSON 契约输出，不要输出契约之外的任何文字。' },
    ],
    tools,
    toolHandlers: handlers,
  })

  const rawJson = JSON.parse(stripMarkdownFence(result.text))
  return MessengerAgentOutputSchema.parse(rawJson)
}

function verifyDraft(
  clientId: string,
  agentOutput: MessengerAgentOutput,
  brandRedlinePhrases: string[],
  knowledge: LoadedDraftContext['knowledge'],
): VerifierResult {
  const verify = resolveVerifierPolicy(clientId)
  if (!verify) {
    return { ok: false, blocked_reasons: [`no_verifier_policy_for_client: ${clientId}`], require_human_confirm: true }
  }
  return verify({ clientId, agentOutput, brandRedlinePhrases, knowledge })
}

async function loadIndustry(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('clients').select('industry').eq('id', clientId).maybeSingle()
  if (error) throw new Error(`查客户行业失败: ${error.message}`)
  return (data as { industry: string | null } | null)?.industry ?? null
}

// ---------------------------------------------------------------------------
// fakeStep —— 跟 __tests__/conversation-inbound-draft.test.ts 里的同名手法
// (`handlerOf`/`fakeStep`) 完全一致：直接拿 Inngest 包装前的原始 handler
// （`.fn`），喂一个假 step。那份测试文件里的同一个桥接写法已经在现有测试套件
// 实测跑绿、长期在 CI 里保持通过——这里原样复用同一个已验证过的桥接手法，
// 不是新造一个未验证的类型转换。
//
// step.run 原样执行真实回调（不跳过任何一步真实逻辑）；waitForEvent 按调用
// 顺序消费一个预设队列——第一次对应 wait-autoack（永远当作"F1 已送达"立即放行，
// 不是 gate，跟生产语义一致），第二次对应 await-approval：
//   - 不模拟批准：返回 null（等同 4 小时超时），handler 走 markTimedOutIfPending
//     真实路径，落 'timed_out'——但 verify 当时真实写入的 blocked_reasons /
//     verifier_output_json 不会被这一步覆盖，分类判断看这两列，不看最终状态。
//   - 模拟批准：在这次 waitForEvent 调用内部，真的执行一次跟 F3 route.ts
//     approve 分支完全一致的原子条件 UPDATE（同一个 WHERE verifier_status='pending'
//     写法——route.ts 的 handleDraftDecision 是模块私有函数不能 import，这里
//     用同一个 WHERE 子句原样复刻，不是另造一套判断），再调用真实的
//     emitConversationApprovalEvent（send 依赖换成假实现，不打真实 Inngest 网络），
//     最后返回一个匹配值让 handler 往下走到 Step send。
// ---------------------------------------------------------------------------

type Fn = ReturnType<typeof createConversationInboundDraftFunction>
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<DraftReceipt> }).fn
}

function fakeStep(simulateApproval: boolean) {
  let waitIndex = 0
  let capturedDraftId: string | null = null
  const sentEvents: unknown[] = []

  return {
    run: async (id: string, fn: () => Promise<unknown> | unknown) => {
      const result = await fn()
      if (id === 'persist-draft' && result && typeof result === 'object' && 'id' in (result as object)) {
        capturedDraftId = (result as { id: string }).id
      }
      return result
    },
    waitForEvent: async (_id: string) => {
      const idx = waitIndex++
      if (idx === 0) {
        // wait-autoack：纯排序，永远当作已送达。
        return { data: {} }
      }
      // await-approval
      if (!simulateApproval || !capturedDraftId) {
        return null // 等同超时——handler 会真的调用 markTimedOutIfPending。
      }
      const { data: approvedRows, error: approveError } = await supabaseAdmin
        .from('conversation_reply_drafts')
        .update({ verifier_status: 'approved', decided_at: new Date().toISOString(), decided_by_email: DRYRUN_APPROVER_EMAIL })
        .eq('id', capturedDraftId)
        .eq('verifier_status', 'pending')
        .select('id')
      if (approveError) throw new Error(`模拟批准写库失败: ${approveError.message}`)
      if (!approvedRows || approvedRows.length === 0) {
        // 草稿当时不是 pending（比如已经被 verifier block）——跟生产行为一致：
        // 批准落不到 approved，也就走不到 send。
        return null
      }
      await emitConversationApprovalEvent(
        { draftId: capturedDraftId, clientId: CLIENT_ID, conversationId: '', decidedByEmail: DRYRUN_APPROVER_EMAIL },
        { send: async (event) => ({ event_ids: [event.id] }) }, // 假 send：不打真实 Inngest 网络
      )
      return { data: { draft_id: capturedDraftId } }
    },
    sendEvent: async (_id: string, payload: unknown) => {
      sentEvents.push(payload)
      return { ids: ['dryrun-evt'] }
    },
    sentEvents,
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

interface RunResult {
  conversation_id: string
  category: string
  expected: string
  expected_reason: string
  trigger_message_id: string | null
  outcome: string
  verifier_status: string | null
  blocked_reasons: string[] | null
  approval_simulated: boolean
  approval_actually_reached: boolean
  send_captured: FakeSendRecord | null
  matches_expectation: boolean
  notes: string
}

async function loadTriggerMessage(conversationId: string): Promise<{ message_id: string; sent_at: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('message_id, sent_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`查触发消息失败 ${conversationId}: ${error.message}`)
  return data as { message_id: string; sent_at: string } | null
}

const deps: ConversationInboundDraftDeps = {
  isOptedOut: isConversationOptedOut,
  isEnabled: isChannelEnabled,
  classify: classifyConversation,
  loadIndustry,
  loadContext: loadDraftContext,
  runAgent: runDraftAgent,
  verify: verifyDraft,
  persistDraft,
  updateDraftStatus,
  markTimedOutIfPending,
  loadApprovedDraft,
  loadLastInboundAt,
  send: fakeSend,
}

async function runOne(exp: Expectation): Promise<RunResult> {
  const trigger = await loadTriggerMessage(exp.conversation_id)
  if (!trigger) {
    return {
      conversation_id: exp.conversation_id,
      category: exp.category,
      expected: exp.expected,
      expected_reason: exp.expected_reason,
      trigger_message_id: null,
      outcome: 'no_inbound_message_found',
      verifier_status: null,
      blocked_reasons: null,
      approval_simulated: false,
      approval_actually_reached: false,
      send_captured: null,
      matches_expectation: false,
      notes: '分支库里查不到这条对话的入站消息——数据复制有缺漏',
    }
  }

  const fn = createConversationInboundDraftFunction(deps)
  const step = fakeStep(Boolean(exp.simulateApproval))
  const event = {
    channel: 'messenger',
    client_id: CLIENT_ID,
    conversation_id: exp.conversation_id,
    message_id: trigger.message_id,
    contact_id: null,
    direction: 'inbound',
    sent_at: trigger.sent_at,
  }

  let receipt: DraftReceipt
  let runError: string | null = null
  try {
    receipt = await handlerOf(fn)({ event: { id: `dryrun-evt-${exp.conversation_id}`, data: event }, step, runId: `dryrun-run-${exp.conversation_id}` })
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err)
    receipt = {
      outcome: 'draft_error',
      conversation_id: exp.conversation_id,
      client_id: CLIENT_ID,
      channel: 'messenger',
      draft_id: null,
      detail: runError,
    }
  }

  // 读回这条草稿真实落库的 verifier_status / blocked_reasons——不看 receipt.outcome
  // 是不是 'timed_out'，那只反映"人工有没有批准"，不反映 verifier 本身的判断。
  let verifierStatus: string | null = null
  let blockedReasons: string[] | null = null
  if (receipt.draft_id) {
    const { data } = await supabaseAdmin
      .from('conversation_reply_drafts')
      .select('verifier_status, blocked_reasons')
      .eq('id', receipt.draft_id)
      .maybeSingle()
    if (data) {
      verifierStatus = (data as any).verifier_status
      blockedReasons = (data as any).blocked_reasons ?? null
    }
  }

  const approvalReached = verifierStatus === 'approved'
  const sendCaptured = fakeSentLog.find((s) => s.conversationId === exp.conversation_id) ?? null

  const isBlockedLike = verifierStatus === 'blocked' || receipt.outcome === 'blocked'
  let matches: boolean
  if (exp.expected === 'blocked') {
    matches = isBlockedLike
  } else if (exp.expected === 'approved_or_pending') {
    matches = !isBlockedLike && receipt.outcome !== 'draft_error'
  } else {
    matches = true // error_acceptable：这条本来就不追求特定结果
  }

  return {
    conversation_id: exp.conversation_id,
    category: exp.category,
    expected: exp.expected,
    expected_reason: exp.expected_reason,
    trigger_message_id: trigger.message_id,
    outcome: receipt.outcome,
    verifier_status: verifierStatus,
    blocked_reasons: blockedReasons,
    approval_simulated: Boolean(exp.simulateApproval),
    approval_actually_reached: approvalReached,
    send_captured: sendCaptured,
    matches_expectation: matches,
    notes: runError ? `跑出真实异常: ${runError}` : '',
  }
}

async function main() {
  console.log(`开始跑 ${EXPECTATIONS.length} 条 dry-run（分支库 project dzuczcspabpgvppzgfxx）...`)
  const results: RunResult[] = []
  for (const exp of EXPECTATIONS) {
    console.log(`  跑 ${exp.conversation_id} (${exp.category}) ...`)
    const r = await runOne(exp)
    results.push(r)
    console.log(`    -> outcome=${r.outcome} verifier_status=${r.verifier_status} matches=${r.matches_expectation}`)
  }

  const outPath = path.join(__dirname, 'run-results.json')
  fs.writeFileSync(outPath, JSON.stringify({ results, fakeSentLog }, null, 2), 'utf-8')
  console.log(`\n写完 ${outPath}`)

  const categories = Array.from(new Set(EXPECTATIONS.map((e) => e.category.replace('(边缘发现)', ''))))
  const matchCount = results.filter((r) => r.matches_expectation).length
  console.log(`\n准确率: ${matchCount}/${results.length}`)
  console.log(`覆盖类别: ${categories.join(', ')}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('dry-run 脚本本身异常终止:', err)
    process.exit(1)
  })
