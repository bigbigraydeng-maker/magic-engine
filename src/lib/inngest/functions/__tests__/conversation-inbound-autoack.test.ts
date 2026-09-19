/**
 * F1 自动安抚回复（issue #1584）装配 + 关键路径测试。
 *
 * 分四块：
 *   1. `parseMessageReceived` —— 复用共享 Zod 契约的校验行为
 *   2. `resolvePostSaleClassificationPolicy` —— 按行业选 Playbook，不认识的
 *      行业不猜、不套旅游判据
 *   3. 装配契约 —— 事件名 / retries / debounce 配置，不撞
 *      `WORKER_OWNED_EVENTS`
 *   4. 关键路径变异测试 —— opt-out 命中/未命中、kill switch 开/关、
 *      post_sale/lead_intake 分类两条路径，每条都断言"没被跳过的检查
 *      压根没被调用"，不是只看返回值
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createConversationInboundAutoAckFunction,
  parseMessageReceived,
  resolvePostSaleClassificationPolicy,
  AUTOACK_TEMPLATE,
  AUTOACK_SENT_BY_EMAIL,
  CONVERSATION_AUTOACK_SENT_EVENT,
  type ConversationInboundAutoAckDeps,
} from '../conversation-inbound-autoack'
import { CONVERSATION_MESSAGE_RECEIVED_EVENT } from '@/lib/conversations/events'
import { TOURISM_POST_SALE_POLICY, type ConversationClass } from '@/lib/messenger-agent/classify'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'
import type { SendReplyResult } from '@/lib/messenger/send'
import type { SendWhatsAppResult } from '@/lib/whatsapp/send'

// 跟 `knowledge-mining.test.ts`/`factory-creatomate-render.test.ts` 同一份读法：
// `.opts`/`.fn` 不是 Inngest SDK 对外暴露的公开类型，但实测在当前 inngest
// 包版本（package.json 锁的 3.54.0）下这两个字段运行时真实存在——测试本身
// 跑通（`npx vitest run`）就是最直接的验证，跟那两个既有测试文件用的是
// 同一个已验证过的桥接写法，不是本文件新引入的猜测。
type Fn = ReturnType<typeof createConversationInboundAutoAckFunction>
function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: {
      triggers?: { event?: string }[]
      retries?: number
      debounce?: { period?: string; key?: string }
    }
  }).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

const CLIENT_ID = 'client-cts'
const CONVERSATION_ID = 'conv-1'
const MESSAGE_ID = 'mid.1'
const SENT_AT = '2026-09-15T00:00:00.000Z'

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

/** step.run/step.sendEvent 假实现——跟 `post-measurement-contract.test.ts` 同一写法。 */
function fakeStep() {
  const sentEvents: unknown[] = []
  return {
    run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()),
    sendEvent: vi.fn(async (_id: string, payload: unknown) => {
      sentEvents.push(payload)
      return { ids: ['evt-1'] }
    }),
    sentEvents,
  }
}

function messengerSendOk(): SendReplyResult {
  return { ok: true, metaMessageId: 'mid.reply', window: 'standard' }
}
function whatsappSendOk(): SendWhatsAppResult {
  return { ok: true, whatsappMessageId: 'wamid.1', window: 'open' }
}

function makeDeps(overrides: Partial<ConversationInboundAutoAckDeps> = {}): ConversationInboundAutoAckDeps {
  return {
    isOptedOut: vi.fn(async () => false),
    isEnabled: vi.fn(async () => true),
    classify: vi.fn(async (): Promise<ConversationClass> => 'lead_intake'),
    loadIndustry: vi.fn(async () => null),
    send: { messenger: vi.fn(async () => messengerSendOk()), whatsapp: vi.fn(async () => whatsappSendOk()) },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1) parseMessageReceived
// ---------------------------------------------------------------------------

describe('parseMessageReceived', () => {
  it('accepts a well-formed inbound messenger payload', () => {
    const parsed = parseMessageReceived(messageReceived())
    expect(parsed.ok).toBe(true)
  })

  it.each([
    ['missing client_id', { client_id: undefined }],
    ['invalid channel', { channel: 'sms' }],
    ['invalid direction', { direction: 'sideways' }],
    ['missing sent_at', { sent_at: undefined }],
    ['not an object', undefined as unknown as Record<string, unknown>],
  ])('rejects %s', (_label, overrides) => {
    const raw = overrides === undefined ? undefined : messageReceived(overrides)
    const parsed = parseMessageReceived(raw)
    expect(parsed.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2) resolvePostSaleClassificationPolicy —— 按行业选 Playbook
// ---------------------------------------------------------------------------

describe('resolvePostSaleClassificationPolicy', () => {
  it('旅游关键词命中的行业 → TOURISM_POST_SALE_POLICY', () => {
    expect(resolvePostSaleClassificationPolicy('Travel — Tour Operator')).toBe(TOURISM_POST_SALE_POLICY)
    expect(resolvePostSaleClassificationPolicy('旅游')).toBe(TOURISM_POST_SALE_POLICY)
  })

  it('认不出的行业（地产/建材/空）→ null，不套旅游判据', () => {
    expect(resolvePostSaleClassificationPolicy('real_estate')).toBeNull()
    expect(resolvePostSaleClassificationPolicy('SPC/hybrid flooring wholesale (B2B trade)')).toBeNull()
    expect(resolvePostSaleClassificationPolicy(null)).toBeNull()
    expect(resolvePostSaleClassificationPolicy(undefined)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3) 装配契约
// ---------------------------------------------------------------------------

describe('装配契约', () => {
  it('id 带 cloud- 前缀，触发事件是 conversation/message.received', () => {
    const fn = createConversationInboundAutoAckFunction(makeDeps())
    expect(fn.id()).toBe(`${CLOUD_FN_PREFIX}conversation-inbound-autoack`)
    expect(optsOf(fn).triggers?.[0]?.event).toBe(CONVERSATION_MESSAGE_RECEIVED_EVENT)
  })

  it('retries 恰好是 1（issue 明确要求，不是别的样板函数的 0/2/3）', () => {
    const fn = createConversationInboundAutoAckFunction(makeDeps())
    expect(optsOf(fn).retries).toBe(1)
  })

  it('debounce 恰好是 30 秒、按 conversation_id 分组（变异测试：改错 period/key 这条就会挂——真正的多消息合并成一次发送是 Inngest 服务端按这份配置调度的，应用层单测只能验证配置本身没被写错/漏配）', () => {
    const fn = createConversationInboundAutoAckFunction(makeDeps())
    expect(optsOf(fn).debounce).toEqual({ period: '30s', key: 'event.data.conversation_id' })
  })

  it('触发/产出事件都不在 WORKER_OWNED_EVENTS 里（一事件一主契约）', () => {
    const fn = createConversationInboundAutoAckFunction(makeDeps())
    const triggerEvent = optsOf(fn).triggers?.[0]?.event
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(triggerEvent as string)).toBe(false)
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(CONVERSATION_AUTOACK_SENT_EVENT)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4) 关键路径变异测试
// ---------------------------------------------------------------------------

describe('关键路径', () => {
  it('invalid payload → skipped_invalid_payload，任何检查都不调', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: { not: 'valid' } }, step })
    expect(result).toMatchObject({ outcome: 'skipped_invalid_payload' })
    expect(deps.isOptedOut).not.toHaveBeenCalled()
    expect(deps.isEnabled).not.toHaveBeenCalled()
    expect(deps.classify).not.toHaveBeenCalled()
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it('outbound 方向的消息 → skipped_invalid_payload，不触发安抚', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({
      event: { id: 'evt-1', data: messageReceived({ direction: 'outbound' }) },
      step,
    })
    expect(result).toMatchObject({ outcome: 'skipped_invalid_payload' })
    expect(deps.isOptedOut).not.toHaveBeenCalled()
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it('opt-out 命中 → skipped_opted_out，kill switch/分类/发送全部不调（变异测试）', async () => {
    const deps = makeDeps({ isOptedOut: vi.fn(async () => true) })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    expect(result).toMatchObject({ outcome: 'skipped_opted_out', conversation_id: CONVERSATION_ID })
    expect(deps.isEnabled).not.toHaveBeenCalled()
    expect(deps.classify).not.toHaveBeenCalled()
    expect(deps.send.messenger).not.toHaveBeenCalled()
    expect(step.sendEvent).not.toHaveBeenCalled()
  })

  it('opt-out 未命中 → 继续往下走（不会被误判成命中）', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    expect(result).toMatchObject({ outcome: 'sent' })
  })

  it('kill switch 关（enabled=false）→ skipped_channel_disabled，绝不走到 CHANNEL_SEND（issue 明确要求：断 send mock 没被调用，不是只看返回值）', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => false) })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    expect(result).toMatchObject({ outcome: 'skipped_channel_disabled' })
    expect(deps.classify).not.toHaveBeenCalled()
    expect(deps.send.messenger).not.toHaveBeenCalled()
    expect(deps.send.whatsapp).not.toHaveBeenCalled()
    expect(step.sendEvent).not.toHaveBeenCalled()
  })

  it('kill switch 开（enabled=true）→ 继续往下走，最终真的发送', async () => {
    const deps = makeDeps({ isEnabled: vi.fn(async () => true) })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    expect(result).toMatchObject({ outcome: 'sent' })
    expect(deps.send.messenger).toHaveBeenCalledTimes(1)
  })

  it('分类为 post_sale → skipped_post_sale，不发安抚（发送 mock 断言，不是只看返回值）', async () => {
    const deps = makeDeps({
      loadIndustry: vi.fn(async () => 'Travel — Tour Operator'),
      classify: vi.fn(async (): Promise<ConversationClass> => 'post_sale'),
    })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    expect(result).toMatchObject({ outcome: 'skipped_post_sale' })
    expect(deps.send.messenger).not.toHaveBeenCalled()
    expect(step.sendEvent).not.toHaveBeenCalled()
    // 传给 classify 的必须是旅游 Playbook，不是别的
    expect(deps.classify).toHaveBeenCalledWith(CONVERSATION_ID, TOURISM_POST_SALE_POLICY)
  })

  it('分类为 lead_intake → 正常发送，body 是硬编码模板、usedAiDraft=false、sentByEmail 是系统身份', async () => {
    const deps = makeDeps({
      loadIndustry: vi.fn(async () => 'Travel — Tour Operator'),
      classify: vi.fn(async (): Promise<ConversationClass> => 'lead_intake'),
    })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    expect(result).toMatchObject({ outcome: 'sent' })
    expect(deps.send.messenger).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      conversationId: CONVERSATION_ID,
      body: AUTOACK_TEMPLATE,
      sentByEmail: AUTOACK_SENT_BY_EMAIL,
      usedAiDraft: false,
    })
  })

  it('认不出行业（没有 Playbook）→ 不调 classify，直接按 lead_intake 继续发送', async () => {
    const deps = makeDeps({ loadIndustry: vi.fn(async () => 'real_estate') })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    expect(result).toMatchObject({ outcome: 'sent' })
    expect(deps.classify).not.toHaveBeenCalled()
  })

  it('🔴 Codex 复审：查行业真的报错（不是"合法地没填"）→ 必须抛错，绝不能悄悄当成"没有 Playbook"然后照常发送', async () => {
    const deps = makeDeps({ loadIndustry: vi.fn(async () => { throw new Error('db 抽风') }) })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    await expect(handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })).rejects.toThrow('db 抽风')
    expect(deps.send.messenger).not.toHaveBeenCalled()
    expect(step.sendEvent).not.toHaveBeenCalled()
  })

  it('发送失败（ok:false）→ send_failed，不 emit 收尾事件', async () => {
    const deps = makeDeps({
      send: {
        messenger: vi.fn(
          async (): Promise<SendReplyResult> => ({
            ok: false,
            status: 409,
            error: '窗口关了',
            reason: 'window_closed',
          }),
        ),
        whatsapp: vi.fn(async (): Promise<SendWhatsAppResult> => whatsappSendOk()),
      },
    })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    expect(result).toMatchObject({ outcome: 'send_failed', detail: 'window_closed' })
    expect(step.sendEvent).not.toHaveBeenCalled()
  })

  it('发送成功 → emit conversation/autoack.sent，事件 id 幂等键带会话 id + event.id，且带上触发消息 id + provider 回执 id（Codex 复审补）', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    await handlerOf(fn)({ event: { id: 'evt-42', data: messageReceived() }, step })
    expect(step.sentEvents).toEqual([
      {
        id: `autoack:${CONVERSATION_ID}:evt-42`,
        name: CONVERSATION_AUTOACK_SENT_EVENT,
        data: {
          client_id: CLIENT_ID,
          conversation_id: CONVERSATION_ID,
          channel: 'messenger',
          trigger_message_id: MESSAGE_ID,
          provider_message_id: 'mid.reply',
        },
      },
    ])
  })

  it('🔴 Codex 复审：发送失败是 provider 侧瞬时故障（status 502）→ 必须抛错让 Inngest 重试，不是静默吞掉返回终态', async () => {
    const deps = makeDeps({
      send: {
        messenger: vi.fn(
          async (): Promise<SendReplyResult> => ({
            ok: false,
            status: 502,
            error: 'Meta 拒绝了这条消息，请稍后重试',
            reason: 'graph_failed',
          }),
        ),
        whatsapp: vi.fn(async (): Promise<SendWhatsAppResult> => whatsappSendOk()),
      },
    })
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    await expect(handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })).rejects.toThrow()
    expect(step.sendEvent).not.toHaveBeenCalled()
  })

  it('🔴 魏征复审：step.sendEvent 是顶层调用，绝不嵌套在 step.run 里面（真实 Inngest SDK 会对嵌套发 NESTING_STEPS 警告，且破坏幂等哈希）——退回嵌套写法这条测试必须挂', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    await handlerOf(fn)({ event: { id: 'evt-1', data: messageReceived() }, step })
    // 4 个真实副作用各自一个 step.run：opt-out / kill-switch / classify / send。
    // emit 不算在内——它必须是 step.sendEvent 的顶层调用，不是包在第 5 个
    // step.run 里面。
    expect(step.run).toHaveBeenCalledTimes(4)
    expect(step.sendEvent).toHaveBeenCalledTimes(1)
  })

  it('whatsapp 渠道 → 走 send.whatsapp，不是 send.messenger', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({
      event: { id: 'evt-1', data: messageReceived({ channel: 'whatsapp' }) },
      step,
    })
    expect(result).toMatchObject({ outcome: 'sent' })
    expect(deps.send.whatsapp).toHaveBeenCalledTimes(1)
    expect(deps.send.messenger).not.toHaveBeenCalled()
  })

  it('不支持的渠道（email/voice）→ skipped_invalid_payload，不猜、不硬转成 messenger/whatsapp', async () => {
    const deps = makeDeps()
    const fn = createConversationInboundAutoAckFunction(deps)
    const step = fakeStep()
    const result = await handlerOf(fn)({
      event: { id: 'evt-1', data: messageReceived({ channel: 'email' }) },
      step,
    })
    expect(result).toMatchObject({ outcome: 'skipped_invalid_payload' })
    expect(deps.isOptedOut).not.toHaveBeenCalled()
  })
})
