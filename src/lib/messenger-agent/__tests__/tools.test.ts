/**
 * `src/lib/messenger-agent/tools.ts` 的 2 轴红线变异测试(Issue #1580 验证要求
 * · v3 改接 `getClientKnowledge`)。
 *
 * 核心断言跟 `src/lib/agent-tools/readonly/__tests__/isolation.test.ts` 同一套
 * 写法:即便 Claude 在工具 input 里**伪造**了别客户/别会话的资源标识符,
 * handler 也**只用服务端 ctx.*** 去调底层函数。每个断言同时是变异测试——
 * 若 handler 改用 input.* 泄漏,断言必 fail(下面每组用例都配了一条"伪造 xxx
 * 被忽略",实测跑过:临时把 handler 改成读 input.* 会让对应断言立刻报错,
 * 证明这些断言不是摆设)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterBrief } from '@/types/magic-engine'
import type { KnowledgeEntry, KnowledgeReadResult } from '@/lib/knowledge'

vi.mock('@/lib/knowledge', () => ({ getClientKnowledge: vi.fn() }))
vi.mock('@/lib/content/brief-injector', () => ({ getActiveBrief: vi.fn() }))

import { getClientKnowledge } from '@/lib/knowledge'
import { getActiveBrief } from '@/lib/content/brief-injector'
import {
  queryCustomerFacingFacts,
  queryConversationHistory,
  queryClientBrandFacts,
  buildMessengerAgentTools,
  type MessengerAgentToolContext,
  type MessengerAgentToolModule,
} from '../tools'

const mockGetClientKnowledge = vi.mocked(getClientKnowledge)
const mockGetActiveBrief = vi.mocked(getActiveBrief)

// ---------------------------------------------------------------------------
// 假 supabase 查询构造器:链式方法返回自身,最终既可以 `await` 整个 builder
// (靠 `then`),也可以显式调 `.maybeSingle()` —— 两种用法 tools.ts 里都有。
//
// 这里的对象形状是手搭的查询链,天然跟 `SupabaseClient` 的真实类型对不上,
// 需要绕开结构检查——跟 `agent-tools/readonly/__tests__/isolation.test.ts`
// 里 `{ __marker: 'real-supabase' } as unknown as ReadonlyToolContext['supabase']`
// 同一个已验证可用的写法(该文件的变异测试套件长期在 CI 跑绿)。只在这一处
// 转换,其余测试代码一律用这个函数拿到已经转换好的假客户端,不重复散落断言。
// ---------------------------------------------------------------------------
function asSupabase(fake: { from: (table: string) => unknown }): SupabaseClient {
  return fake as unknown as SupabaseClient
}

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function fact(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'fact-1',
    clientId: REAL_CLIENT_ID,
    factKey: 'tour.active.golden-china',
    scope: {},
    statement: 'Golden China tour',
    structuredValue: { code: 'golden-china', price_nzd: 100 },
    conflictGroupId: null,
    status: 'approved',
    visibility: 'customer_ok',
    sensitivity: 'price',
    validFrom: '2026-09-01T00:00:00Z',
    validUntil: null,
    lastVerifiedAt: null,
    approvedByEmail: 'ray@magicengine.cloud',
    approvedAt: '2026-09-01T00:00:00Z',
    clientConfirmedByEmail: 'client@ctstours.co.nz',
    clientConfirmedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function knowledgeResult(entries: KnowledgeEntry[], forbiddenFactKeys: string[] = []): KnowledgeReadResult {
  return { entries, forbiddenFactKeys }
}

// 本次会话真实身份(ctx 服务端注入)
const REAL_CLIENT_ID = 'client-REAL'
const REAL_CONVERSATION_ID = 'convo-REAL'

// 攻击者试图通过工具 input 注入的别客户 / 别会话资源标识符
const FORGED = {
  client_id: 'client-VICTIM',
  clientId: 'client-VICTIM',
  conversation_id: 'convo-VICTIM',
  conversationId: 'convo-VICTIM',
  domain: 'victim-competitor.com',
  site_url: 'https://victim-competitor.com/',
  property_id: 'properties/999',
}

beforeEach(() => {
  vi.clearAllMocks()
})

function realCtx(fake: { from: (table: string) => unknown } = { from: vi.fn() }): MessengerAgentToolContext {
  return {
    clientId: REAL_CLIENT_ID,
    conversationId: REAL_CONVERSATION_ID,
    supabase: asSupabase(fake),
  }
}

describe('query_customer_facing_facts — clientId 越权轴锁死', () => {
  it('伪造 client_id 入参被忽略,只用 ctx.clientId', async () => {
    mockGetClientKnowledge.mockResolvedValue(knowledgeResult([]))
    await queryCustomerFacingFacts.handler({ ...FORGED, intent_keywords: ['Silk Road'] }, realCtx())
    // 🔴 变异守卫:若 handler 用了 input.client_id,这里会是 client-VICTIM → fail
    expect(mockGetClientKnowledge).toHaveBeenCalledWith(REAL_CLIENT_ID, { purpose: 'customer_reply' })
    expect(mockGetClientKnowledge).not.toHaveBeenCalledWith('client-VICTIM', expect.anything())
  })

  it('无关键词时返回全部商业敏感事实(price/timeline/commitment/policy)', async () => {
    mockGetClientKnowledge.mockResolvedValue(
      knowledgeResult([
        fact({ factKey: 'tour.active.golden-china', sensitivity: 'price' }),
        fact({ factKey: 'policy.visa_free_entry', sensitivity: 'policy' }),
        fact({ factKey: 'company.years_operating', sensitivity: 'general' }),
      ]),
    )
    const out = JSON.parse(await queryCustomerFacingFacts.handler({}, realCtx()))
    expect(out.facts).toHaveLength(2)
    expect(out.facts.map((f: { fact_key: string }) => f.fact_key).sort()).toEqual([
      'policy.visa_free_entry',
      'tour.active.golden-china',
    ])
    expect(out.matched_by_keywords).toBeNull()
  })

  it('sensitivity=general 的事实不出现在结果里(留给 query_client_brand_facts)', async () => {
    mockGetClientKnowledge.mockResolvedValue(
      knowledgeResult([fact({ factKey: 'company.years_operating', sensitivity: 'general' })]),
    )
    const out = JSON.parse(await queryCustomerFacingFacts.handler({}, realCtx()))
    expect(out.facts).toHaveLength(0)
  })

  it('关键词过滤命中/不命中(匹配 statement)', async () => {
    mockGetClientKnowledge.mockResolvedValue(
      knowledgeResult([
        fact({ factKey: 'tour.active.golden-china', statement: 'Golden China tour departs 2026-11-16' }),
        fact({ factKey: 'tour.active.silk-road', statement: 'Silk Road Discovery tour' }),
      ]),
    )
    const out = JSON.parse(await queryCustomerFacingFacts.handler({ intent_keywords: ['silk'] }, realCtx()))
    expect(out.facts).toHaveLength(1)
    expect(out.facts[0].fact_key).toBe('tour.active.silk-road')
  })

  it('getClientKnowledge 抛错时返回 error 字段,不静默吞掉', async () => {
    mockGetClientKnowledge.mockRejectedValue(new Error('knowledge base unavailable'))
    const out = JSON.parse(await queryCustomerFacingFacts.handler({}, realCtx()))
    expect(out.error).toContain('knowledge base unavailable')
  })
})

describe('query_conversation_history — clientId + conversationId 越权轴锁死', () => {
  it('伪造 client_id/conversation_id 入参被忽略,只用 ctx 的值查询', async () => {
    const conversationsBuilder = makeQueryBuilder({
      data: { id: REAL_CONVERSATION_ID, client_id: REAL_CLIENT_ID },
      error: null,
    })
    const messagesBuilder = makeQueryBuilder({
      data: [{ direction: 'inbound', sender_name: 'Alice', body: 'hi', sent_at: '2026-09-13T00:00:00Z' }],
      error: null,
    })
    const from = vi.fn((table: string) => (table === 'conversations' ? conversationsBuilder : messagesBuilder))

    const out = JSON.parse(
      await queryConversationHistory.handler({ ...FORGED }, realCtx({ from })),
    )

    // 🔴 变异守卫:ownership 校验必须用 ctx 的 clientId/conversationId,不是伪造值
    expect(conversationsBuilder.eq).toHaveBeenCalledWith('id', REAL_CONVERSATION_ID)
    expect(conversationsBuilder.eq).toHaveBeenCalledWith('client_id', REAL_CLIENT_ID)
    expect(conversationsBuilder.eq).not.toHaveBeenCalledWith('id', 'convo-VICTIM')
    expect(conversationsBuilder.eq).not.toHaveBeenCalledWith('client_id', 'client-VICTIM')

    // 🔴 消息查询同样只能用 ctx.conversationId
    expect(messagesBuilder.eq).toHaveBeenCalledWith('conversation_id', REAL_CONVERSATION_ID)
    expect(messagesBuilder.eq).not.toHaveBeenCalledWith('conversation_id', 'convo-VICTIM')

    expect(out.conversation_scoped).toBe(true)
    expect(out.messages).toHaveLength(1)
  })

  it('会话不属于该客户(ownership 查不到)→ 返回错误,绝不去读消息表', async () => {
    const conversationsBuilder = makeQueryBuilder({ data: null, error: null })
    const messagesFrom = vi.fn()
    const from = vi.fn((table: string) => (table === 'conversations' ? conversationsBuilder : messagesFrom()))

    const out = JSON.parse(await queryConversationHistory.handler({}, realCtx({ from })))

    expect(out.error).toContain('not found')
    expect(messagesFrom).not.toHaveBeenCalled()
  })

  it('查会话失败(数据库报错)→ 返回错误,不吞掉', async () => {
    const conversationsBuilder = makeQueryBuilder({ data: null, error: { message: 'db down' } })
    const from = vi.fn(() => conversationsBuilder)

    const out = JSON.parse(await queryConversationHistory.handler({}, realCtx({ from })))
    expect(out.error).toContain('db down')
  })
})

describe('query_client_brand_facts — clientId 越权轴锁死', () => {
  it('伪造 client_id 入参被忽略,只用 ctx.clientId(brief 与知识库两处都要锁)', async () => {
    const fakeBrief: Partial<MasterBrief> = {
      brand_name: 'CTS Tours NZ', tagline: 'x', tone: 'friendly',
      primary_audience: 'NZ mainstream', pain_points: [], buying_trigger: undefined, avoid_words: [],
    }
    mockGetActiveBrief.mockResolvedValue(fakeBrief as MasterBrief)
    mockGetClientKnowledge.mockResolvedValue(knowledgeResult([]))

    await queryClientBrandFacts.handler({ ...FORGED }, realCtx())

    // 🔴 变异守卫:若 handler 用了 input.client_id,这里会是 client-VICTIM → fail
    expect(mockGetActiveBrief).toHaveBeenCalledWith(REAL_CLIENT_ID)
    expect(mockGetActiveBrief).not.toHaveBeenCalledWith('client-VICTIM')
    expect(mockGetClientKnowledge).toHaveBeenCalledWith(REAL_CLIENT_ID, { purpose: 'customer_reply' })
  })

  it('只返回 sensitivity=general 的知识库事实', async () => {
    mockGetActiveBrief.mockResolvedValue(null)
    mockGetClientKnowledge.mockResolvedValue(
      knowledgeResult([
        fact({ factKey: 'company.years_operating', sensitivity: 'general', statement: '25 years' }),
        fact({ factKey: 'tour.active.golden-china', sensitivity: 'price' }),
      ]),
    )
    const out = JSON.parse(await queryClientBrandFacts.handler({}, realCtx()))
    expect(out.general_facts).toHaveLength(1)
    expect(out.general_facts[0].fact_key).toBe('company.years_operating')
  })

  it('没有 active brief 也没有 general 事实时返回 note,不报错、不编造品牌信息', async () => {
    mockGetActiveBrief.mockResolvedValue(null)
    mockGetClientKnowledge.mockResolvedValue(knowledgeResult([]))
    const out = JSON.parse(await queryClientBrandFacts.handler({}, realCtx()))
    expect(out.note).toContain('No active Master Brief')
  })

  it('知识库读取失败时仍带着 brief 数据降级返回,不整体报错', async () => {
    const fakeBrief: Partial<MasterBrief> = { brand_name: 'CTS Tours NZ' }
    mockGetActiveBrief.mockResolvedValue(fakeBrief as MasterBrief)
    mockGetClientKnowledge.mockRejectedValue(new Error('knowledge base down'))

    const out = JSON.parse(await queryClientBrandFacts.handler({}, realCtx()))
    expect(out.brand_name).toBe('CTS Tours NZ')
    expect(out.general_facts).toEqual([])
  })
})

describe('input_schema 零资源标识符(2 轴红线闸 1)', () => {
  const FORBIDDEN = [
    'client_id', 'clientId', 'conversation_id', 'conversationId',
    'config_slug', 'configSlug', 'domain', 'site_url', 'siteUrl',
    'property_id', 'propertyId',
  ]
  const modules: MessengerAgentToolModule[] = [
    queryCustomerFacingFacts, queryConversationHistory, queryClientBrandFacts,
  ]

  it.each(modules.map((m) => [m.tool.name, m] as const))(
    '%s 的 input_schema 不暴露任何资源标识符字段',
    (_name, mod) => {
      const props = (mod.tool.input_schema as { properties?: Record<string, unknown> }).properties ?? {}
      for (const key of Object.keys(props)) {
        expect(FORBIDDEN).not.toContain(key)
      }
    },
  )
})

describe('buildMessengerAgentTools — 工厂把 ctx 冻结进闭包', () => {
  it('返回的 3 个 handler 名字齐全,且共用同一个注入的 ctx', async () => {
    mockGetClientKnowledge.mockResolvedValue(knowledgeResult([]))
    mockGetActiveBrief.mockResolvedValue(null)
    const conversationsBuilder = makeQueryBuilder({ data: null, error: null })
    const from = vi.fn(() => conversationsBuilder)

    const { tools, handlers } = buildMessengerAgentTools({
      clientId: REAL_CLIENT_ID,
      conversationId: REAL_CONVERSATION_ID,
      supabase: asSupabase({ from }),
    })

    expect(tools.map((t) => t.name).sort()).toEqual([
      'query_client_brand_facts', 'query_conversation_history', 'query_customer_facing_facts',
    ])
    expect(Object.keys(handlers).sort()).toEqual([
      'query_client_brand_facts', 'query_conversation_history', 'query_customer_facing_facts',
    ])

    // 伪造入参依旧不影响:工厂组出来的 handler 也只认闭包里的 ctx
    await handlers.query_customer_facing_facts({ client_id: 'client-VICTIM' })
    expect(mockGetClientKnowledge).toHaveBeenCalledWith(REAL_CLIENT_ID, { purpose: 'customer_reply' })
  })
})
