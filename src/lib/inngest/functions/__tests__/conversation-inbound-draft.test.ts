/**
 * F2 AI 起草回复主函数（issue #1585）装配 + 关键路径测试。
 *
 * 分七块：
 *   1. `parseMessageReceived` —— 复用共享 Zod 契约的校验行为
 *   2. 装配契约 —— 事件名 / retries / concurrency / debounce / idempotency 配置，
 *      不撞 `WORKER_OWNED_EVENTS`，且真的注册进了 `cloudFunctions`（否则部署后
 *      不会运行——魏征复审 B1）
 *   3. kill-check 三项独立判断 —— opt-out / kill switch / post-sale，任一命中
 *      直接 return，其余检查/起草/发送全部不调（变异测试）
 *   4. 起草 → 验证 → 存草稿 → 等批准 —— 起草失败不 throw、verifier 拦截、
 *      超时（含"超时判定前一刻已被人工决定"的竞态，子牙+魏征复审）
 *   5. Step send —— 二次 opt-out/开关/窗口检查、defensive 重读 draft_body
 *      （改后发送场景）、长度硬校验、502 让 Inngest 重试 vs 其余失败落终态
 *   6. `waitForEvent` 的 `if` 表达式契约锁定——F3 消费端已经在自己的单测里锁死
 *      生产端字面量，这里锁消费端（魏征+子牙复审 B9/H4：此前零断言，改成
 *      `match` 或改错事件名/字段名，29 条测试原本全绿）
 *   7. `loadDraftContext` 生产实现——历史消息排序（子牙+魏征复审 B1/B3：先前
 *      升序+limit 取到的是对话**最老**的 N 条，不是"最近 N 条"，DI 版单测测
 *      不出来，这里直接测生产实现）
 *   8. `parseAgentJson`——issue #1772（魏征复审 issue #1591 dry-run 实测发现）：
 *      Claude 偶尔在纯 JSON 前面多包一层解释性文字，直接 `JSON.parse` 会炸，
 *      落进 `draft_error`。真实数据 26.7% 概率触发，这里锁住"能容忍前缀多说
 *      一句话"跟"真坏的输出仍然要抛错"两条行为
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/content/brief-injector', () => ({ getActiveBrief: vi.fn(async () => null) }))
vi.mock('@/lib/knowledge', async (orig) => {
  const actual = await orig<typeof import('@/lib/knowledge')>()
  return { ...actual, getClientKnowledge: vi.fn(async () => ({ entries: [], forbiddenFactKeys: [] })) }
})

import {
  createConversationInboundDraftFunction,
  parseMessageReceived,
  parseAgentJson,
  DRAFT_SENT_BY_EMAIL,
  CONVERSATION_REPLY_BLOCKED_EVENT,
  CONVERSATION_REPLY_SEND_FAILED_EVENT,
  CONVERSATION_REPLY_TIMEOUT_EVENT,
  type ConversationInboundDraftDeps,
} from '../conversation-inbound-draft'
import { loadDraftContext, type LoadedDraftContext } from '../conversation-inbound-draft-store'
import { cloudFunctions } from '../index'
import {
  CONVERSATION_MESSAGE_RECEIVED_EVENT,
  CONVERSATION_AUTOACK_SENT_EVENT,
  CONVERSATION_REPLY_APPROVED_EVENT,
} from '@/lib/conversations/events'
import { TOURISM_POST_SALE_POLICY, type ConversationClass } from '@/lib/messenger-agent/classify'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'
import { supabaseAdmin } from '@/lib/supabase'
import type { MessengerAgentOutput } from '@/lib/messenger-agent/agent-output-schema'
import type { VerifierResult } from '@/lib/messenger-agent/verifier/framework'
import type { SendReplyResult } from '@/lib/messenger/send'
import type { SendWhatsAppResult } from '@/lib/whatsapp/send'

const mockFrom = vi.mocked(supabaseAdmin.from)

// 同一份桥接写法见 conversation-inbound-autoack.test.ts / knowledge-mining.test.ts /
// factory-creatomate-render.test.ts —— `.opts`/`.fn` 不是公开类型，但实测在当前
// inngest 包版本下运行时真实存在。
type Fn = ReturnType<typeof createConversationInboundDraftFunction>
function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: {
      triggers?: { event?: string }[]
      retries?: number
      concurrency?: { limit?: number; key?: string }
      debounce?: { period?: string; key?: string }
      idempotency?: string
    }
  }).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

const CLIENT_ID = 'client-cts'
const CONVERSATION_ID = 'conv-1'
const MESSAGE_ID = 'mid.1'
// 相对当前时间，而不是写死的日期——写死的日期会随时间推移撞进
// messagingWindow/whatsappWindow 的窗口边界，让测试在跟代码改动无关的某天突然
// 变红（魏征复审 B8：之前硬编码 2026-09-15 会在 2026-09-21 之后让 happy path 挂掉）。
const SENT_AT = new Date(Date.now() - 60_000).toISOString()
const DRAFT_ID = 'draft-uuid-1'
const RUN_ID = 'run-1'

function messageReceived(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'messenger',
    client_id: CLIENT_ID,
    conversation_id: CONVERSATION_ID,
    message_id: MESSAGE_ID,
    contact_id: null,
    direction: 'inbound',
    sent_at: SENT_AT,
    ...overrides,
  }
}

function invoke(fn: Fn, step: ReturnType<typeof fakeStep>, dataOverrides: Record<string, unknown> = {}) {
  return handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived(dataOverrides) }, step, runId: RUN_ID })
}

/** step.run/sendEvent 直接跑；waitForEvent 按调用顺序消费一个预设结果队列。 */
function fakeStep(waitForEventResults: unknown[] = [{ ok: true }, { ok: true }]) {
  const sentEvents: unknown[] = []
  let waitIndex = 0
  return {
    run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()),
    waitForEvent: vi.fn(async () => waitForEventResults[waitIndex++] ?? null),
    sendEvent: vi.fn(async (_id: string, payload: unknown) => {
      sentEvents.push(payload)
      return { ids: ['evt-1'] }
    }),
    sentEvents,
  }
}

function fakeContext(): LoadedDraftContext {
  return { brief: null, knowledge: { entries: [], forbiddenFactKeys: [] }, brandRedlinePhrases: [], history: [] }
}

function fakeAgentOutput(overrides: Partial<MessengerAgentOutput> = {}): MessengerAgentOutput {
  return { reply_text: '您好，这个团现在有位。', confidence: 0.8, offerings: [], ...overrides }
}

function okVerifier(): VerifierResult {
  return { ok: true, blocked_reasons: [], require_human_confirm: true }
}
function blockedVerifier(reasons: string[] = ['brand_redline: 命中禁用词']): VerifierResult {
  return { ok: false, blocked_reasons: reasons, require_human_confirm: true }
}

function messengerSendOk(): SendReplyResult {
  return { ok: true, metaMessageId: 'mid.reply', window: 'standard' }
}
function whatsappSendOk(): SendWhatsAppResult {
  return { ok: true, whatsappMessageId: 'wamid.1', window: 'open' }
}

function makeDeps(overrides: Partial<ConversationInboundDraftDeps> = {}): ConversationInboundDraftDeps {
  return {
    isOptedOut: vi.fn(async () => false),
    isEnabled: vi.fn(async () => true),
    classify: vi.fn(async (): Promise<ConversationClass> => 'lead_intake'),
    loadIndustry: vi.fn(async () => null),
    loadContext: vi.fn(async () => fakeContext()),
    runAgent: vi.fn(async () => fakeAgentOutput()),
    verify: vi.fn(() => okVerifier()),
    persistDraft: vi.fn(async () => ({ id: DRAFT_ID })),
    updateDraftStatus: vi.fn(async () => {}),
    markTimedOutIfPending: vi.fn(async () => true),
    loadApprovedDraft: vi.fn(async () => ({ draft_body: '您好，这个团现在有位。', verifier_status: 'approved' })),
    loadLastInboundAt: vi.fn(async () => SENT_AT),
    send: { messenger: vi.fn(async () => messengerSendOk()), whatsapp: vi.fn(async () => whatsappSendOk()) },
    ...overrides,
  }
}

beforeEach(() => {
  mockFrom.mockReset()
})

// ---------------------------------------------------------------------------
// 1) parseMessageReceived
// ---------------------------------------------------------------------------

describe('parseMessageReceived', () => {
  it('accepts a well-formed inbound payload', () => {
    expect(parseMessageReceived(messageReceived()).ok).toBe(true)
  })

  it.each([
    ['missing client_id', { client_id: undefined }],
    ['invalid channel', { channel: 'sms' }],
    ['not an object', undefined as unknown as Record<string, unknown>],
  ])('rejects %s', (_label, overrides) => {
    const raw = overrides === undefined ? undefined : messageReceived(overrides)
    expect(parseMessageReceived(raw).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2) 装配契约
// ---------------------------------------------------------------------------

describe('装配契约', () => {
  it('id 带 cloud- 前缀，触发事件是 conversation/message.received', () => {
    const fn = createConversationInboundDraftFunction(makeDeps())
    expect(fn.id()).toBe(`${CLOUD_FN_PREFIX}conversation-inbound-draft`)
    expect(optsOf(fn).triggers?.[0]?.event).toBe(CONVERSATION_MESSAGE_RECEIVED_EVENT)
  })

  it('retries=2，concurrency 按 conversation_id 限并发为 1（防同一会话并行跑两份治理管线）', () => {
    const fn = createConversationInboundDraftFunction(makeDeps())
    expect(optsOf(fn).retries).toBe(2)
    expect(optsOf(fn).concurrency).toEqual({ limit: 1, key: 'event.data.conversation_id' })
  })

  it('debounce 20 秒、按 conversation_id 分组', () => {
    const fn = createConversationInboundDraftFunction(makeDeps())
    expect(optsOf(fn).debounce).toEqual({ period: '20s', key: 'event.data.conversation_id' })
  })

  it('idempotency 按 message_id（issue #1585 改动范围逐字要求，魏征+子牙复审 H3）', () => {
    const fn = createConversationInboundDraftFunction(makeDeps())
    expect(optsOf(fn).idempotency).toBe('event.data.message_id')
  })

  it('触发事件不在 WORKER_OWNED_EVENTS 里（一事件一主契约）', () => {
    const fn = createConversationInboundDraftFunction(makeDeps())
    const triggerEvent = optsOf(fn).triggers?.[0]?.event
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(triggerEvent as string)).toBe(false)
  })

  it('真的注册进了 cloudFunctions（魏征复审 B1：只 import 不进数组，部署后整条链路不会运行）', () => {
    const ids = cloudFunctions.map((fn) => fn.id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}conversation-inbound-draft`)
  })
})

// ---------------------------------------------------------------------------
// 3) kill-check 三项独立判断
// ---------------------------------------------------------------------------

describe('kill-check', () => {
  it('invalid payload → skipped_invalid_payload，任何依赖都不调', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundDraftFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: { not: 'valid' } }, step, runId: RUN_ID })
    expect(result).toMatchObject({ outcome: 'skipped_invalid_payload' })
    expect(deps.isOptedOut).not.toHaveBeenCalled()
    expect(deps.runAgent).not.toHaveBeenCalled()
  })

  it('outbound 方向 → skipped_invalid_payload，不触发起草', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep(), { direction: 'outbound' })
    expect(result).toMatchObject({ outcome: 'skipped_invalid_payload' })
    expect(deps.isOptedOut).not.toHaveBeenCalled()
  })

  it('opt-out 命中 → skipped_opted_out，kill switch/分类/起草/发送全部不调', async () => {
    const deps = makeDeps({ isOptedOut: vi.fn(async () => true) })
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'skipped_opted_out', conversation_id: CONVERSATION_ID })
    expect(deps.isEnabled).not.toHaveBeenCalled()
    expect(deps.classify).not.toHaveBeenCalled()
    expect(deps.runAgent).not.toHaveBeenCalled()
  })

  it('kill switch 关 → skipped_channel_disabled，分类/起草/发送全部不调', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => false) })
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'skipped_channel_disabled' })
    expect(deps.classify).not.toHaveBeenCalled()
    expect(deps.runAgent).not.toHaveBeenCalled()
  })

  it('分类为 post_sale → skipped_post_sale，不起草，传给 classify 的是旅游 Playbook', async () => {
    const deps = makeDeps({
      loadIndustry: vi.fn(async () => 'Travel — Tour Operator'),
      classify: vi.fn(async (): Promise<ConversationClass> => 'post_sale'),
    })
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'skipped_post_sale' })
    expect(deps.runAgent).not.toHaveBeenCalled()
    expect(deps.classify).toHaveBeenCalledWith(CONVERSATION_ID, TOURISM_POST_SALE_POLICY)
  })

  it('认不出行业 → 不调 classify，按 lead_intake 继续往下走', async () => {
    const deps = makeDeps({ loadIndustry: vi.fn(async () => 'real_estate') })
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(deps.classify).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: 'sent' })
  })
})

// ---------------------------------------------------------------------------
// 4) 起草 → 验证 → 存草稿 → 等批准
// ---------------------------------------------------------------------------

describe('起草/验证/等批准', () => {
  it('起草失败（agent 抛错）→ draft_error，不 throw、不靠 Inngest retry，落一条 error 状态草稿', async () => {
    const deps = makeDeps({ runAgent: vi.fn(async () => { throw new Error('Claude 超时') }) })
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'draft_error', draft_id: DRAFT_ID, detail: expect.stringContaining('Claude 超时') })
    expect(deps.persistDraft).toHaveBeenCalledWith(
      expect.objectContaining({ verifierStatus: 'error', draftBody: '', inngestRunId: RUN_ID }),
    )
    expect(deps.verify).not.toHaveBeenCalled()
  })

  it(
    '🔴 魏征+子牙复审：起草失败必须在 step.run 回调内部被捕获，step.run 本身绝不能抛错——' +
      '包在外面会被 Inngest 按函数级 retries 重试这一步，Claude 实际会被调最多 3 次',
    async () => {
      const deps = makeDeps({ runAgent: vi.fn(async () => { throw new Error('Claude 超时') }) })
      const fn = createConversationInboundDraftFunction(deps)
      const step = fakeStep()
      await invoke(fn, step)
      // step.run 的 fake 实现只是直接 await 回调——如果回调本身抛错，
      // 这个 await 会拒绝、handler 整体会抛出，invoke() 的 promise 会 reject。
      // 上一个用例已经证明 invoke() 正常 resolve 到 draft_error，这里额外断言
      // draft 这个 step.run 调用没有被记录为抛错（vitest 的 vi.fn 在其回调
      // reject 时那次调用本身仍然"被调用过"，但如果代码没有让它 reject，
      // 这里改为直接验证 runAgent 确实只被调了一次——不靠 Inngest 的重试机制
      // 补第二次调用，因为这里的 fakeStep 根本不模拟重试，真正防回归的验证点
      // 是"回调有没有 reject"，已由 invoke() 正常 resolve 这件事本身证明。
      expect(deps.runAgent).toHaveBeenCalledTimes(1)
    },
  )

  it('verifier 拦截 → 存草稿 verifier_status=blocked，emit reply.blocked，返回 blocked', async () => {
    const deps = makeDeps({ verify: vi.fn(() => blockedVerifier(['brand_redline: x'])) })
    const fn = createConversationInboundDraftFunction(deps)
    const step = fakeStep()
    const result = await invoke(fn, step)
    expect(result).toMatchObject({ outcome: 'blocked', draft_id: DRAFT_ID })
    expect(deps.persistDraft).toHaveBeenCalledWith(
      expect.objectContaining({ verifierStatus: 'blocked', blockedReasons: ['brand_redline: x'], inngestRunId: RUN_ID }),
    )
    expect(step.sentEvents).toContainEqual(
      expect.objectContaining({ name: CONVERSATION_REPLY_BLOCKED_EVENT, data: expect.objectContaining({ draft_id: DRAFT_ID }) }),
    )
    // blocked 之后绝不能继续等批准/发送
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it('verifier 通过 → 存草稿 verifier_status=pending，然后才等批准', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundDraftFunction(deps)
    await invoke(fn, fakeStep())
    expect(deps.persistDraft).toHaveBeenCalledWith(expect.objectContaining({ verifierStatus: 'pending', blockedReasons: null }))
  })

  it('等批准真的超时（markTimedOutIfPending 返回 true）→ verifier_status=timed_out，emit reply.timeout，不发送', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundDraftFunction(deps)
    // 第一次 waitForEvent（autoack）正常返回；第二次（await-approval）超时返回 null。
    const step = fakeStep([{ ok: true }, null])
    const result = await invoke(fn, step)
    expect(result).toMatchObject({ outcome: 'timed_out', draft_id: DRAFT_ID, detail: null })
    expect(deps.markTimedOutIfPending).toHaveBeenCalledWith(DRAFT_ID)
    expect(step.sentEvents).toContainEqual(
      expect.objectContaining({ name: CONVERSATION_REPLY_TIMEOUT_EVENT }),
    )
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it(
    '🔴 子牙+魏征复审竞态：F3 在超时判定前一刻已经把草稿改成 rejected' +
      '（markTimedOutIfPending 返回 false）→ 不覆盖状态、不误报 reply.timeout 事故信号',
    async () => {
      const deps = makeDeps({
        markTimedOutIfPending: vi.fn(async () => false),
        loadApprovedDraft: vi.fn(async () => ({ draft_body: '', verifier_status: 'rejected' })),
      })
      const fn = createConversationInboundDraftFunction(deps)
      const step = fakeStep([{ ok: true }, null])
      const result = await invoke(fn, step)
      expect(result).toMatchObject({ outcome: 'timed_out', draft_id: DRAFT_ID, detail: 'already_decided_before_timeout' })
      expect(step.sentEvents).not.toContainEqual(
        expect.objectContaining({ name: CONVERSATION_REPLY_TIMEOUT_EVENT }),
      )
      expect(deps.updateDraftStatus).not.toHaveBeenCalled()
      expect(deps.send.messenger).not.toHaveBeenCalled()
    },
  )

  it(
    '🔴 魏征二轮复审 W1：F3 在超时判定前一刻已经把草稿改成 approved' +
      '（markTimedOutIfPending 返回 false 且当前状态是 approved）→ 不能静默卡死，' +
      '转成 send_failed(reason=approved_after_timeout) 让人工待办能看见',
    async () => {
      const deps = makeDeps({
        markTimedOutIfPending: vi.fn(async () => false),
        loadApprovedDraft: vi.fn(async () => ({ draft_body: '已批准的文案', verifier_status: 'approved' })),
      })
      const fn = createConversationInboundDraftFunction(deps)
      const step = fakeStep([{ ok: true }, null])
      const result = await invoke(fn, step)
      expect(result).toMatchObject({ outcome: 'send_failed', draft_id: DRAFT_ID, detail: 'approved_after_timeout' })
      expect(deps.updateDraftStatus).toHaveBeenCalledWith(DRAFT_ID, { verifier_status: 'send_failed' })
      expect(step.sentEvents).toContainEqual(
        expect.objectContaining({
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: expect.objectContaining({ draft_id: DRAFT_ID, reason: 'approved_after_timeout' }),
        }),
      )
      expect(step.sentEvents).not.toContainEqual(
        expect.objectContaining({ name: CONVERSATION_REPLY_TIMEOUT_EVENT }),
      )
      expect(deps.send.messenger).not.toHaveBeenCalled()
    },
  )

  it('offerings[] 拆成两个数组存进现有列（provenance 一一映射校验已在 verify 完成）', async () => {
    const deps = makeDeps({
      runAgent: vi.fn(async () => fakeAgentOutput({ offerings: [{ name: '丝路秘境', code: 'silk-road' }] })),
    })
    const fn = createConversationInboundDraftFunction(deps)
    await invoke(fn, fakeStep())
    expect(deps.persistDraft).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOfferingCodes: ['silk-road'], quotedOfferingNames: ['丝路秘境'] }),
    )
  })
})

// ---------------------------------------------------------------------------
// 5) Step send —— 二次检查 + defensive 重读 + 长度硬校验
// ---------------------------------------------------------------------------

describe('Step send', () => {
  it(
    '🔴 子牙复审 H1：4 小时等待期间客户中途退订 → send_failed(opted_out_during_approval)，绝不发送' +
      '（opt-out 跟 kill switch 是同等级的 fail-closed 闸，此前 Step send 只复查了开关漏了这条）',
    async () => {
      let call = 0
      const deps = makeDeps({
        isOptedOut: vi.fn(async () => {
          call += 1
          return call > 1 // kill-check 第一次没退订；等批准期间客户退订了
        }),
      })
      const fn = createConversationInboundDraftFunction(deps)
      const step = fakeStep()
      const result = await invoke(fn, step)
      expect(result).toMatchObject({ outcome: 'send_failed', detail: 'opted_out_during_approval' })
      expect(deps.send.messenger).not.toHaveBeenCalled()
      expect(step.sentEvents).toContainEqual(
        expect.objectContaining({
          name: CONVERSATION_REPLY_SEND_FAILED_EVENT,
          data: expect.objectContaining({ reason: 'opted_out_during_approval' }),
        }),
      )
    },
  )

  it('批准后 kill switch 已被关掉 → send_failed(kill_switch_disabled_at_send)，绝不发送', async () => {
    let call = 0
    const deps = makeDeps({
      isEnabled: vi.fn(async () => {
        call += 1
        return call === 1 // 第一次（kill-check）是开的，Step send 复查时已关
      }),
    })
    const fn = createConversationInboundDraftFunction(deps)
    const step = fakeStep()
    const result = await invoke(fn, step)
    expect(result).toMatchObject({ outcome: 'send_failed', detail: 'kill_switch_disabled_at_send' })
    expect(deps.send.messenger).not.toHaveBeenCalled()
    expect(step.sentEvents).toContainEqual(
      expect.objectContaining({ name: CONVERSATION_REPLY_SEND_FAILED_EVENT, data: expect.objectContaining({ reason: 'kill_switch_disabled_at_send' }) }),
    )
  })

  it('窗口已关闭 → send_failed(window_closed)，不发送', async () => {
    const deps = makeDeps({ loadLastInboundAt: vi.fn(async () => null) }) // messagingWindow(null) => closed
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'send_failed', detail: 'window_closed' })
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it('窗口剩不到 30 分钟 → send_failed(window_closing_soon)，不发送（H17）', async () => {
    const almostClosed = new Date(Date.now() - (24 * 60 * 60 * 1000 - 10 * 60 * 1000)).toISOString()
    const deps = makeDeps({ loadLastInboundAt: vi.fn(async () => almostClosed) })
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'send_failed', detail: 'window_closing_soon' })
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it('defensive 重读发现状态不是 approved → send_failed(not_approved_at_send)，fail-closed', async () => {
    const deps = makeDeps({ loadApprovedDraft: vi.fn(async () => ({ draft_body: '...', verifier_status: 'pending' })) })
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'send_failed', detail: 'not_approved_at_send' })
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it('改后发送覆盖过的正文 → 用 loadApprovedDraft 重读到的文本发送，不是内存里 agent 原始草稿', async () => {
    const deps = makeDeps({
      runAgent: vi.fn(async () => fakeAgentOutput({ reply_text: 'AI 原始草稿' })),
      loadApprovedDraft: vi.fn(async () => ({ draft_body: '人工改过的最终文案', verifier_status: 'approved' })),
    })
    const fn = createConversationInboundDraftFunction(deps)
    await invoke(fn, fakeStep())
    expect(deps.send.messenger).toHaveBeenCalledWith(
      expect.objectContaining({ body: '人工改过的最终文案', sentByEmail: DRAFT_SENT_BY_EMAIL, usedAiDraft: true }),
    )
  })

  it('重读到的正文超过 1800 字符硬顶 → send_failed(body_exceeds_length_cap)，不管来源，绝不假设"人已经看过就没问题"', async () => {
    const deps = makeDeps({
      loadApprovedDraft: vi.fn(async () => ({ draft_body: 'a'.repeat(1801), verifier_status: 'approved' })),
    })
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'send_failed', detail: 'body_exceeds_length_cap' })
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it('发送失败（确定性失败，如窗口/权限）→ send_failed 终态，emit reply.send_failed，不 throw', async () => {
    const deps = makeDeps({
      send: {
        messenger: vi.fn(async (): Promise<SendReplyResult> => ({ ok: false, status: 409, error: '窗口关了', reason: 'window_closed' })),
        whatsapp: vi.fn(async (): Promise<SendWhatsAppResult> => whatsappSendOk()),
      },
    })
    const fn = createConversationInboundDraftFunction(deps)
    const step = fakeStep()
    const result = await invoke(fn, step)
    expect(result).toMatchObject({ outcome: 'send_failed', detail: 'window_closed' })
    expect(step.sentEvents).toContainEqual(expect.objectContaining({ name: CONVERSATION_REPLY_SEND_FAILED_EVENT }))
  })

  it('发送失败是 provider 侧瞬时故障（502）→ throw 让 Inngest retries:2 接住', async () => {
    const deps = makeDeps({
      send: {
        messenger: vi.fn(async (): Promise<SendReplyResult> => ({ ok: false, status: 502, error: 'Meta 拒绝', reason: 'graph_failed' })),
        whatsapp: vi.fn(async (): Promise<SendWhatsAppResult> => whatsappSendOk()),
      },
    })
    const fn = createConversationInboundDraftFunction(deps)
    await expect(invoke(fn, fakeStep())).rejects.toThrow()
  })

  it('发送成功 → verifier_status=sent，outcome=sent', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep())
    expect(result).toMatchObject({ outcome: 'sent', draft_id: DRAFT_ID })
    expect(deps.updateDraftStatus).toHaveBeenCalledWith(DRAFT_ID, { verifier_status: 'sent' })
  })

  it('whatsapp 渠道 → 走 send.whatsapp 与 whatsapp 窗口判定，不是 messenger 那一套', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundDraftFunction(deps)
    const result = await invoke(fn, fakeStep(), { channel: 'whatsapp' })
    expect(result).toMatchObject({ outcome: 'sent' })
    expect(deps.send.whatsapp).toHaveBeenCalledTimes(1)
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 6) waitForEvent 的 if 表达式契约锁定
// ---------------------------------------------------------------------------

describe(
  'waitForEvent 契约锁定（魏征+子牙复审 B9/H4：此前零断言，改成 match 或改错事件名/' +
    '字段名/timeout，29 条测试原本全绿——F3 消费端已经锁死生产端字面量，这里补消费端的锁）',
  () => {
    it('wait-autoack：event 名 + if 表达式按 conversation_id 匹配，超时 5 分钟', async () => {
      const deps = makeDeps()
      const fn = createConversationInboundDraftFunction(deps)
      const step = fakeStep()
      await invoke(fn, step)
      expect(step.waitForEvent).toHaveBeenNthCalledWith(1, 'wait-autoack', {
        event: CONVERSATION_AUTOACK_SENT_EVENT,
        timeout: '5m',
        if: `async.data.conversation_id == "${CONVERSATION_ID}"`,
      })
    })

    it(
      'await-approval：event 名 + if 表达式按 draft_id 匹配（v3 补丁#7 · 必须是 if 表达式，' +
        '不是 match:"data.draft_id"），超时 4 小时',
      async () => {
        const deps = makeDeps()
        const fn = createConversationInboundDraftFunction(deps)
        const step = fakeStep()
        await invoke(fn, step)
        expect(step.waitForEvent).toHaveBeenNthCalledWith(2, 'await-approval', {
          event: CONVERSATION_REPLY_APPROVED_EVENT,
          timeout: '4h',
          if: `async.data.draft_id == "${DRAFT_ID}"`,
        })
      },
    )
  },
)

// ---------------------------------------------------------------------------
// 7) loadDraftContext 生产实现——历史消息排序
// ---------------------------------------------------------------------------

describe('loadDraftContext（生产实现）', () => {
  interface MessageRow {
    direction: 'inbound' | 'outbound'
    sender_name: string | null
    body: string | null
    sent_at: string
  }

  /**
   * 造 8 条消息（超过 HISTORY_WINDOW_FOR_DRAFT=5），模拟真实 supabase 链式调用：
   * `conversations` 表返回归属校验通过的行，`clients` 表返回品牌红线，
   * `conversation_messages` 表按 `.order({ascending})` 参数自己排序 + `.limit()`
   * 截断——这样才能验证"实现真的传了 ascending:false"，而不是只验证最终结果
   * 凑巧对（凑巧对的写法测不出"先前的 ascending:true + 不 reverese"这种双重
   * 抵消的错误）。
   */
  function stubDb(messages: MessageRow[]) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: CONVERSATION_ID, client_id: CLIENT_ID }, error: null }),
              }),
            }),
          }),
        } as never
      }
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { brand_redline_phrases: ['禁用词A'] }, error: null }),
            }),
          }),
        } as never
      }
      if (table === 'conversation_messages') {
        return {
          select: () => ({
            eq: () => ({
              order: (_col: string, opts?: { ascending?: boolean }) => ({
                limit: (n: number) => {
                  const ascending = opts?.ascending ?? true
                  const sorted = [...messages].sort((a, b) => {
                    const diff = new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
                    return ascending ? diff : -diff
                  })
                  return Promise.resolve({ data: sorted.slice(0, n), error: null })
                },
              }),
            }),
          }),
        } as never
      }
      throw new Error(`fake supabase: 表 '${table}' 没建模`)
    })
  }

  function msg(i: number, direction: 'inbound' | 'outbound' = 'inbound'): MessageRow {
    return { direction, sender_name: null, body: `消息 ${i}`, sent_at: new Date(2026, 0, 1, 0, i).toISOString() }
  }

  it(
    '🔴 魏征+子牙复审 B1/B3：8 条消息只取最近 5 条，且最新一条（触发本次起草的那条）' +
      '排在数组最后——先前的实现（升序+limit，不 reverse）会拿到消息 1-5（对话开头），漏掉客户刚发的那条',
    async () => {
      const messages = Array.from({ length: 8 }, (_, i) => msg(i + 1))
      stubDb(messages)

      const context = await loadDraftContext(CLIENT_ID, CONVERSATION_ID)

      expect(context.history).toHaveLength(5)
      // 最近 5 条 = 消息 4,5,6,7,8；时间正序意味着数组第一个是最老的（消息 4），
      // 最后一个是最新的（消息 8，也就是触发这次起草的那条）。
      expect(context.history.map((h: { body: string | null }) => h.body)).toEqual([
        '消息 4', '消息 5', '消息 6', '消息 7', '消息 8',
      ])
      expect(context.history[context.history.length - 1].body).toBe('消息 8')
    },
  )

  it('真的按 conversation_id 查询、真的传了品牌红线', async () => {
    stubDb([msg(1)])
    const context = await loadDraftContext(CLIENT_ID, CONVERSATION_ID)
    expect(context.brandRedlinePhrases).toEqual(['禁用词A'])
  })

  it('会话不属于该客户 → 抛错，不静默返回空历史（IDOR 闸）', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        } as never
      }
      throw new Error(`fake supabase: 表 '${table}' 没建模`)
    })
    await expect(loadDraftContext(CLIENT_ID, CONVERSATION_ID)).rejects.toThrow(/会话不属于该客户/)
  })
})

describe('parseAgentJson（issue #1772）', () => {
  const VALID_OUTPUT = { reply_text: '你好', confidence: 0.9, offerings: [] }
  const VALID_JSON = JSON.stringify(VALID_OUTPUT)

  it('纯 JSON，没有任何多余文字 → 照常解析', () => {
    expect(parseAgentJson(VALID_JSON)).toEqual(VALID_OUTPUT)
  })

  it('整段被 ```json 代码块包住 → 照常解析（既有行为，不能因为这次改动退化）', () => {
    expect(parseAgentJson('```json\n' + VALID_JSON + '\n```')).toEqual(VALID_OUTPUT)
  })

  it.each([
    ['客户最新一条消息是问价，', VALID_JSON],
    ['The facts provided support this reply. ', VALID_JSON],
    ['The "Chris" booking referenced above is confirmed. ', VALID_JSON],
    ['The latest customer message asks about pricing. ', VALID_JSON],
    ['根据对话历史，最新一条消息如下分析：', VALID_JSON],
    ["Joyce's last message needs a short reply. ", VALID_JSON],
    ['这条消息是一个典型的问价场景，', VALID_JSON],
  ])('真实故障复现 · 前缀"%s" → 仍能提取出被包住的 JSON', (prefix, json) => {
    expect(parseAgentJson(prefix + json)).toEqual(VALID_OUTPUT)
  })

  it('JSON 后面也多了一句话（不只是前面）→ 一样能提取', () => {
    expect(parseAgentJson(VALID_JSON + ' 以上是我的回复建议。')).toEqual(VALID_OUTPUT)
  })

  it('JSON 字符串字段内部含有花括号 → 括号计数不能被字符串内容干扰', () => {
    const withBraces = { reply_text: '价格是 {约1999} 纽币起', confidence: 0.8, offerings: [] }
    const text = '这是我的分析：' + JSON.stringify(withBraces)
    expect(parseAgentJson(text)).toEqual(withBraces)
  })

  it('真的没有 JSON、纯胡言乱语 → 照原来的行为抛错，不能把胡话当成功', () => {
    expect(() => parseAgentJson('抱歉，我无法起草这条回复。')).toThrow()
  })

  it('花括号没有配平（截断的输出）→ 照原来的行为抛错', () => {
    expect(() => parseAgentJson('前情提要：{ "reply_text": "没写完')).toThrow()
  })

  it('前缀里有裸标识符花括号（不合法 JSON）→ 仍然抛错，不会被误当成功（子牙复审锁定）', () => {
    expect(() => parseAgentJson('这是格式说明 {示例}，' + VALID_JSON)).toThrow()
  })

  it(
    '前缀里恰好带一段语法合法但无关的 JSON 片段 → 提取到的是这段无关片段，不是真实输出' +
      '（已知边界，靠下游 MessengerAgentOutputSchema.strict() 兜底成 draft_error，不在这个' +
      '函数自己的职责范围内区分"哪段才是真答案"——子牙+魏征复审共同确认，锁定当前行为）',
    () => {
      // 故意只断言"取到的是前缀那个无关小对象"，不是"取到真实输出"——这就是这条边界
      // 本身：本函数不做语义判断，多段合法 JSON 时永远拿第一段。
      expect(parseAgentJson('举例说明 {"a": 1}，正式回复是：' + VALID_JSON)).toEqual({ a: 1 })
    },
  )
})
