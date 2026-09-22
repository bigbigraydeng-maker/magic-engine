/**
 * Regression tests for the 2026-09-13 incident: `brief.ts` had "CTS Tours New
 * Zealand" hardcoded as the identity for EVERY client, and `generateBrief`
 * was never given a `clientId` to know better. New Asian Logistics (NAL, a
 * logistics client) got summaries claiming to be CTS, and a phishing message
 * got turned into an invented "wants to know about travel to China" need.
 *
 * The three fixtures below are real production message bodies (verified via
 * Supabase `execute_sql` against conversation_messages / conversation_briefs
 * on 2026-09-13), with sender name / phone / email replaced by synthetic
 * placeholders per coding-style.md ("never place ... private customer data
 * in source ... tests"). The message BODIES that matter for the assertions
 * (the phishing text, "Need more information", the tour-interest form fill)
 * are verbatim:
 *
 *   - conversation_id 32d8cb65-1a16-4048-9776-b9bc8415c1f4 (NAL, client_id
 *     4ae76381-cd45-43bd-85cd-98cfd7604007): phishing "verification badge"
 *     broadcast in styled Unicode. Real stored brief hallucinated
 *     customer_needs = ["了解更多关于中国的旅游信息", ...].
 *   - conversation_id f9459c39-8b04-482a-afac-d77fd1bb3fa6 (same client):
 *     genuine "Need more information" / "Hi~How can I help?" exchange. Real
 *     stored brief wrote "...CTS询问如何提供帮助" — wrong company.
 *   - conversation_id d1ce9901-e307-48c3-9e24-913923767b2b (CTS Tours NZ,
 *     client_id c0000000-0000-0000-0000-000000000000): real lead-form
 *     message naming "Christmas in China - from Auckland". Used as the CTS
 *     regression case — this client's summaries must not degrade.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StoredMessage } from '../brief'
import type { KnowledgeEntry } from '@/lib/knowledge/types'
import { createFakeSupabase } from '@/lib/knowledge/__tests__/fake-supabase'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ responses: { create: mockCreate } })),
}))

let clientsRow: { name: string; industry: string | null } | null = null
let clientsError: string | null = null
let clientsQueryCount = 0

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            clientsQueryCount++
            return clientsError
              ? { data: null, error: { message: clientsError } }
              : { data: clientsRow, error: null }
          },
        }),
      }),
    }),
  },
}))

import {
  generateBrief,
  buildSystemPrompt,
  looksLikeAutomatedSpam,
  noiseBrief,
  type ClientIdentity,
} from '../brief'

const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'
const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

// 真实 conversation_id 32d8cb65-1a16-4048-9776-b9bc8415c1f4 的原文（发件人名已替换为占位符）。
const NAL_PHISHING_MESSAGES: StoredMessage[] = [
  {
    direction: 'inbound',
    senderName: 'Spam Account',
    body:
      '🎉 𝖢𝗈𝗇𝗀𝗋𝖺𝗍𝗎𝗅𝖺𝗍𝗂𝗈𝗇𝗌! 𝖸𝗈𝗎𝗋 𝖺𝖼𝖼𝗈𝗎𝗇𝗍 𝗂𝗌 𝗇𝗈𝗐 𝖾𝗅𝗂𝗀𝗂𝖻𝗅𝖾 𝗍𝗈 𝖺𝖼𝗍𝗂𝗏𝖺𝗍𝖾 𝖺 𝖿𝗋𝖾𝖾 𝖻𝗅𝗎𝖾 𝗏𝖾𝗋𝗂𝖿𝗂𝖼𝖺𝗍𝗂𝗈𝗇 𝖻𝖺𝖽𝗀𝖾 𝗈𝗇 𝗈𝗎𝗋 𝗉𝗅𝖺𝗍𝖿𝗈𝗋𝗆. 𝖳𝗈 𝖺𝖼𝗍𝗂𝗏𝖺𝗍𝖾 𝖺𝗅𝗅 𝗏𝖾𝗋𝗂𝖿𝗂𝖼𝖺𝗍𝗂𝗈𝗇 𝖻𝖾𝗇𝖾𝖿𝗂𝗍𝗌, 𝗉𝗅𝖾𝖺𝗌𝖾 𝖼𝗅𝗂𝖼𝗄 𝗍𝗁𝖾 𝖽𝗈𝖼𝗎𝗆𝖾𝗇𝗍 𝖻𝖾𝗅𝗈𝗐 𝗍𝗈 𝖼𝗈𝗇𝗍𝗂𝗇𝗎𝖾.',
    sentAt: '2026-07-15T05:52:57Z',
  },
  { direction: 'inbound', senderName: 'Spam Account', body: '', sentAt: '2026-07-15T05:52:58Z' },
]

// 真实 conversation_id f9459c39-8b04-482a-afac-d77fd1bb3fa6 的原文（发件人名已替换）。
const NAL_GENUINE_MESSAGES: StoredMessage[] = [
  { direction: 'inbound', senderName: 'Customer', body: 'Need more information', sentAt: '2026-08-29T10:24:10Z' },
  {
    direction: 'outbound',
    senderName: 'NewAsian Logistics',
    body: 'Hi~How can I help?',
    sentAt: '2026-08-30T05:18:15Z',
  },
]

// 真实 conversation_id d1ce9901-e307-48c3-9e24-913923767b2b 的原文（姓名/电话/邮箱已替换为占位符，
// 行程字段 "Christmas in China - from Auckland" 保持原样 —— 这是回归要验证的关键内容）。
const CTS_REAL_MESSAGES: StoredMessage[] = [
  {
    direction: 'inbound',
    senderName: 'Test Customer',
    body:
      'Hello! I filled out your form and would like to know more about your business.\nFull name: Test Customer\nPhone number: 021 000 0000\nWhich tour interests you most?: Christmas in China - from Auckland\nEmail: test.customer@example.com',
    sentAt: '2026-09-13T08:23:14Z',
  },
]

const NAL_IDENTITY: ClientIdentity = { name: 'New Asian Logistics', industry: null }
const CTS_IDENTITY: ClientIdentity = { name: 'CTS Tours NZ', industry: 'travel' }

/**
 * Minimal, fully-typed `KnowledgeEntry` fixture for `buildSystemPrompt` unit
 * tests below — these test the pure rendering function directly, not the
 * `getClientKnowledge` integration (that lives in
 * `brief-cts-knowledge.test.ts`, which exercises the real read path against
 * fixtures shaped like the issue #1647 migration).
 */
function fakeEntry(overrides: Partial<KnowledgeEntry> & { statement: string }): KnowledgeEntry {
  return {
    id: 'fake-fact-id',
    clientId: CTS_CLIENT_ID,
    factKey: 'fake.fact',
    scope: {},
    structuredValue: null,
    conflictGroupId: null,
    status: 'approved',
    visibility: 'customer_ok',
    sensitivity: 'general',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: null,
    lastVerifiedAt: null,
    approvedByEmail: 'ray@magicengine.cloud',
    approvedAt: '2026-01-01T00:00:00.000Z',
    clientConfirmedByEmail: null,
    clientConfirmedAt: null,
    ...overrides,
  }
}

/**
 * `generateBrief` now always attempts a knowledge-base read (issue #1647).
 * This test file is about identity leakage, not the knowledge integration,
 * so every `generateBrief` call below injects a fake Supabase client with NO
 * entitlement grant for anyone — the real production behaviour for any
 * client that hasn't been granted access (`loadClientFacts` catches
 * `KnowledgeNotEntitledError` and treats it as "no facts", see brief.ts),
 * so this does not change what these tests are asserting.
 */
const NOT_ENTITLED_KNOWLEDGE_SUPABASE = createFakeSupabase({
  client_automation_policies: [],
  client_knowledge_facts: [],
  client_knowledge_confirmers: [],
})
const NOT_ENTITLED_DEPS = { knowledge: { supabase: NOT_ENTITLED_KNOWLEDGE_SUPABASE } }

/**
 * CTS's real knowledge rows, shaped like migration
 * `20260915120000_brief_knowledge_migration_and_cts_history.sql` — used by
 * the "CTS 回归" test below to prove the prompt still carries CTS's real
 * facts once they come from the knowledge base instead of a literal in
 * brief.ts (issue #1647's headline acceptance criterion). The full
 * integration against `getClientKnowledge` (including the visa-policy
 * historical-grandfather row) is covered separately in
 * `brief-cts-knowledge.test.ts`.
 */
const CTS_ENTITLED_KNOWLEDGE_SUPABASE = createFakeSupabase({
  client_automation_policies: [
    {
      client_id: CTS_CLIENT_ID,
      action_key: 'client_knowledge.read',
      mode: 'auto_approve',
      updated_by: 'migration:1647',
      effective_from: '2026-01-01T00:00:00.000Z',
      effective_to: null,
      metadata: { basis: 'fde_managed' },
    },
  ],
  client_knowledge_facts: [
    {
      id: 'c1000000-0000-0000-0000-000000000001',
      client_id: CTS_CLIENT_ID,
      fact_key: 'company.years_operating',
      scope: {},
      statement: 'This business has operated in New Zealand for 25 years.',
      structured_value: { years: 25 },
      conflict_group_id: null,
      status: 'approved',
      visibility: 'customer_ok',
      sensitivity: 'general',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: null,
      last_verified_at: null,
      approved_by_email: 'migration:1647',
      approved_at: '2026-01-01T00:00:00.000Z',
      client_confirmed_by_email: null,
      client_confirmed_at: null,
      client_confirmed_fingerprint: null,
      historical_confirmation_grandfather_until: null,
    },
    {
      id: 'c1000000-0000-0000-0000-000000000003',
      client_id: CTS_CLIENT_ID,
      fact_key: 'support.escalation_contact',
      scope: {},
      statement:
        'For anything you should not attempt to resolve yourself, offer a human follow-up via 0800 287 888 / info@ctstours.co.nz.',
      structured_value: { phone: '0800 287 888', email: 'info@ctstours.co.nz' },
      conflict_group_id: null,
      status: 'approved',
      visibility: 'customer_ok',
      sensitivity: 'general',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: null,
      last_verified_at: null,
      approved_by_email: 'migration:1647',
      approved_at: '2026-01-01T00:00:00.000Z',
      client_confirmed_by_email: null,
      client_confirmed_at: null,
      client_confirmed_fingerprint: null,
      historical_confirmation_grandfather_until: null,
    },
  ],
  client_knowledge_confirmers: [],
  // 🔴 issue #1648（rollout stage + channel gate）合并后 getClientKnowledge(customer_reply)
  // 新增了这一道闸：没有 phase=2 事件 + messenger 开关 = 默认落 stage 0（最不放行的默认值），
  // 这个 fixture 建于 #1648 之前，本就没设过这两张表。这里显式设成"已上线"，让本文件继续
  // 只测它原来要测的东西（dual-sign / 事实渲染），不被这道正交的新闸挡住——跟 read.test.ts
  // 里 LIVE_PHASE_EVENT / MESSENGER_ENABLED_CLIENT 默认值的处理方式一致。
  client_knowledge_events: [
    {
      client_id: CTS_CLIENT_ID,
      dimension: 'phase',
      value: '2',
      actor_email: 'ray@magicengine.cloud',
      reason: null,
      payload: {},
      created_at: '2026-03-01T00:00:00.000Z',
    },
  ],
  clients: [{ id: CTS_CLIENT_ID, messenger_agent_enabled_messenger: true }],
})
const CTS_ENTITLED_DEPS = { knowledge: { supabase: CTS_ENTITLED_KNOWLEDGE_SUPABASE } }

function mockModelReply(payload: Record<string, unknown>) {
  mockCreate.mockResolvedValueOnce({ output_text: JSON.stringify(payload) })
}

const BASE_REPLY_FIELDS = {
  intent_level: 'medium',
  objections: [],
  promises_made: [],
  next_action: null,
  follow_up_due_at: null,
  risk_flags: [],
  contact: { phone: null, email: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  clientsRow = null
  clientsError = null
  clientsQueryCount = 0
  process.env.OPENAI_API_KEY = 'test-key'
})

describe('looksLikeAutomatedSpam — 花体字钓鱼广告识别（纯函数，不需要模型）', () => {
  it('🔴 真实钓鱼广告（32d8cb65 原文）判定为噪音', () => {
    expect(looksLikeAutomatedSpam(NAL_PHISHING_MESSAGES)).toBe(true)
  })

  it('🔴 真实客户问询（f9459c39 原文："Need more information"）不判定为噪音', () => {
    expect(looksLikeAutomatedSpam(NAL_GENUINE_MESSAGES)).toBe(false)
  })

  it('真实 CTS 表单留资不判定为噪音', () => {
    expect(looksLikeAutomatedSpam(CTS_REAL_MESSAGES)).toBe(false)
  })

  it('偶尔用几个花体字签名的正常短消息不该被误伤（占比判据，不是绝对数）', () => {
    const messages: StoredMessage[] = [
      {
        direction: 'inbound',
        senderName: 'Customer',
        body: 'Hi there, interested in a quote for 2 pallets please 𝓐my',
        sentAt: '2026-09-01T00:00:00Z',
      },
    ]
    expect(looksLikeAutomatedSpam(messages)).toBe(false)
  })

  it('一条对话里混了历史垃圾消息但也有真实问询时，不整体判噪音', () => {
    const mixed: StoredMessage[] = [
      ...NAL_PHISHING_MESSAGES,
      { direction: 'inbound', senderName: 'Customer', body: 'Do you ship to Wellington?', sentAt: '2026-08-01T00:00:00Z' },
    ]
    expect(looksLikeAutomatedSpam(mixed)).toBe(false)
  })

  it('没有任何非空 inbound 消息时不判噪音（没东西可判）', () => {
    expect(looksLikeAutomatedSpam([])).toBe(false)
  })
})

describe('noiseBrief', () => {
  it('不编造需求、不清空原对话、不生成可自动发送的回复', () => {
    const brief = noiseBrief()
    expect(brief.customer_needs).toEqual([])
    expect(brief.draft_reply).toBe('')
    expect(brief.trip).toEqual({
      tour_interest: null,
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    })
    expect(brief.risk_flags.join()).toContain('垃圾')
  })
})

describe('buildSystemPrompt — 身份与事实必须来自参数，不能写死', () => {
  it('🔴 给 NAL 生成的提示词里没有 "CTS" 三个字', () => {
    const prompt = buildSystemPrompt(NAL_IDENTITY, [])
    // 用词边界匹配而不是裸子串：GROUNDING 里的通用措辞 "CLIENT FACTS" 本身就
    // 以 "FACTS" 结尾、含有 "CTS" 子串，裸 toContain('CTS') 会对每个客户都假阳性。
    expect(prompt).not.toMatch(/\bCTS\b/)
    expect(prompt).toContain('New Asian Logistics')
  })

  it('非旅游客户拿到的是"trip 必须全 null"的指令，而不是行程专属指令', () => {
    const prompt = buildSystemPrompt(NAL_IDENTITY, [])
    expect(prompt).toContain('MUST be null')
    expect(prompt).not.toContain('NAMES — tour names')
  })

  it('🔴 给 CTS 生成的提示词包含它自己的真实事实，且不出现别的客户名字', () => {
    const entries = [fakeEntry({ statement: 'This business has operated in New Zealand for 25 years.' })]
    const prompt = buildSystemPrompt(CTS_IDENTITY, entries)
    expect(prompt).toContain('CTS Tours NZ')
    expect(prompt).toContain('operated in New Zealand for 25 years')
    expect(prompt).not.toContain('New Asian Logistics')
  })

  it('没有已批准知识条目的旅游客户不会被塞进别的客户的事实（entries 不会跨客户泄漏）', () => {
    const otherTravelClient: ClientIdentity = { name: 'Some Other Travel Co', industry: 'travel' }
    const prompt = buildSystemPrompt(otherTravelClient, [])
    expect(prompt).not.toContain('25 years')
    // 不是裸 "CLIENT FACTS"（GROUNDING 通用措辞里本来就有这几个字），
    // 而是 clientFactsBlock 真正拼出事实区块时才会出现的完整标题。
    expect(prompt).not.toContain('CLIENT FACTS — the only extra facts')
  })

  it('🔴 industry 是自由文本（生产库真实存量值 "Travel — Tour Operator"）也要认成旅游客户', () => {
    // 魏征实施后复审发现：裸字符串相等 `=== 'travel'` 会漏判 clients.industry
    // 里的自由文本历史值，生产库里 Kiwi Silk Road Travel (DEMO) 存的正是这个值。
    // isTravelIndustry 改用仓库已有的 hasIndustryFeature 之后必须认得出它。
    const freeTextTravelClient: ClientIdentity = {
      name: 'Kiwi Silk Road Travel',
      industry: 'Travel — Tour Operator',
    }
    const prompt = buildSystemPrompt(freeTextTravelClient, [])
    expect(prompt).toContain('NAMES — tour names')
    expect(prompt).not.toContain('MUST be null')
  })

  it('🔴 "never write X, instead say Y" 这类订正（structuredValue 带 wrong/insteadSay）渲染成纠正措辞，不是当作可直接说的事实', () => {
    const entries = [
      fakeEntry({
        statement: 'irrelevant if structuredValue is set',
        structuredValue: { wrong: '"since 1928"', insteadSay: '1928 belongs to someone else' },
      }),
    ]
    const prompt = buildSystemPrompt(CTS_IDENTITY, entries)
    expect(prompt).toContain('Never write "since 1928". Instead: 1928 belongs to someone else')
  })
})

describe('generateBrief — 端到端：钓鱼广告短路，不进模型', () => {
  it('🔴 命中噪音判定直接返回 noiseBrief，不查 clients 表也不调模型，也不读知识库', async () => {
    const { brief, knowledgeStatus } = await generateBrief(NAL_PHISHING_MESSAGES, NAL_CLIENT_ID, undefined, NOT_ENTITLED_DEPS)
    expect(brief.customer_needs).toEqual([])
    expect(brief.summary).not.toContain('旅游')
    expect(mockCreate).not.toHaveBeenCalled()
    expect(clientsQueryCount).toBe(0)
    expect(knowledgeStatus).toBeNull()
  })
})

describe('generateBrief — 未配置模型 API key（dev/test 环境）', () => {
  it('🔴 没有 key 时零网络调用：不查 clients 表，也不调模型，也不读知识库，直接走确定性 fallback', async () => {
    delete process.env.OPENAI_API_KEY
    clientsRow = NAL_IDENTITY

    const { brief, knowledgeStatus } = await generateBrief(NAL_GENUINE_MESSAGES, NAL_CLIENT_ID, undefined, NOT_ENTITLED_DEPS)

    expect(brief.summary).toContain('未生成 AI 摘要')
    expect(mockCreate).not.toHaveBeenCalled()
    expect(clientsQueryCount).toBe(0)
    expect(knowledgeStatus).toBeNull()
  })
})

describe('generateBrief — 端到端：NAL（真实非旅游客户，industry=null）', () => {
  it('🔴 给 NAL 生成的摘要不含 "CTS"，且发给模型的系统提示词也不含 "CTS"', async () => {
    clientsRow = NAL_IDENTITY
    mockModelReply({
      ...BASE_REPLY_FIELDS,
      summary: '客户询问更多信息，NewAsian Logistics 已回复。',
      customer_needs: ['了解更多信息'],
      trip: {
        tour_interest: null,
        travel_window: null,
        party_size: null,
        departure_city: null,
        first_time_to_china: null,
        budget_signal: null,
      },
      draft_reply: 'Thanks for reaching out — happy to help, what do you need a quote for?',
    })

    const { brief } = await generateBrief(NAL_GENUINE_MESSAGES, NAL_CLIENT_ID, undefined, NOT_ENTITLED_DEPS)

    expect(brief.summary).not.toContain('CTS')
    expect(brief.customer_needs).toEqual(['了解更多信息'])
    const sentPrompt = mockCreate.mock.calls[0][0].input[0].content as string
    expect(sentPrompt).not.toMatch(/\bCTS\b/)
    expect(sentPrompt).toContain('New Asian Logistics')
  })

  it('🔴 对抗性响应：模型仍然编了 trip，代码闸必须把它清空（NAL industry=null 场景）', async () => {
    clientsRow = NAL_IDENTITY
    const adversarialTrip = {
      tour_interest: '了解更多关于中国的旅游信息',
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    }
    // 锚点：先确认这份 mock 数据本身确实带着非空 trip —— 不然下面「被清空」这个
    // 断言测的就是一个从没发生过的动作。
    expect(adversarialTrip.tour_interest).not.toBeNull()

    mockModelReply({
      ...BASE_REPLY_FIELDS,
      summary: '客户想了解中国旅游信息。',
      customer_needs: ['了解更多关于中国的旅游信息'],
      trip: adversarialTrip,
      draft_reply: '',
    })

    const { brief } = await generateBrief(NAL_GENUINE_MESSAGES, NAL_CLIENT_ID, undefined, NOT_ENTITLED_DEPS)

    expect(brief.trip).toEqual({
      tour_interest: null,
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    })
  })

  it('clients 表读取失败（网络抖动）必须整体抛出，不能悄悄退化成中性身份', async () => {
    clientsError = 'connection reset by peer'
    await expect(
      generateBrief(NAL_GENUINE_MESSAGES, NAL_CLIENT_ID, undefined, NOT_ENTITLED_DEPS),
    ).rejects.toThrow('connection reset by peer')
  })

  it('查无此客户（真的没有这一行）退化成中性身份，绝不假冒成 CTS 或任何别的客户', async () => {
    clientsRow = null
    clientsError = null
    mockModelReply({
      ...BASE_REPLY_FIELDS,
      summary: '客户询问更多信息。',
      customer_needs: [],
      trip: {
        tour_interest: null,
        travel_window: null,
        party_size: null,
        departure_city: null,
        first_time_to_china: null,
        budget_signal: null,
      },
      draft_reply: '',
    })

    await generateBrief(NAL_GENUINE_MESSAGES, NAL_CLIENT_ID, undefined, NOT_ENTITLED_DEPS)
    const sentPrompt = mockCreate.mock.calls[0][0].input[0].content as string
    expect(sentPrompt).not.toMatch(/\bCTS\b/)
    expect(sentPrompt).toContain('this business')
  })
})

describe('generateBrief — 回归：CTS 真实客户（industry=travel）质量不因这次改动退化', () => {
  it('🔴 CTS 摘要保留行程信息（tour_interest / departure_city 不被硬闸清空）', async () => {
    clientsRow = CTS_IDENTITY
    mockModelReply({
      ...BASE_REPLY_FIELDS,
      summary: 'Test Customer 对 "Christmas in China" 感兴趣，从奥克兰出发。',
      customer_needs: ['了解更多关于 "Christmas in China" 的信息'],
      trip: {
        tour_interest: 'Christmas in China',
        travel_window: null,
        party_size: null,
        departure_city: 'Auckland',
        first_time_to_china: null,
        budget_signal: null,
      },
      contact: { phone: '021 000 0000', email: 'test.customer@example.com' },
      draft_reply: 'Hi Test Customer, thanks for your interest in Christmas in China — from Auckland!',
    })

    const { brief } = await generateBrief(CTS_REAL_MESSAGES, CTS_CLIENT_ID, undefined, CTS_ENTITLED_DEPS)

    expect(brief.trip.tour_interest).toBe('Christmas in China')
    expect(brief.trip.departure_city).toBe('Auckland')

    const sentPrompt = mockCreate.mock.calls[0][0].input[0].content as string
    expect(sentPrompt).toContain('CTS Tours NZ')
    expect(sentPrompt).toContain('operated in New Zealand for 25 years')
    // 🔴 issue #1647 核心验收标准：这些事实现在来自知识库条目（见
    // CTS_ENTITLED_KNOWLEDGE_SUPABASE fixture），不是 brief.ts 里的字面量——
    // 完整的 getClientKnowledge 集成回归见 brief-cts-knowledge.test.ts。
    expect(sentPrompt).toContain('0800 287 888')
    expect(sentPrompt).toContain('info@ctstours.co.nz')
    expect(sentPrompt).not.toContain('New Asian Logistics')
  })
})

describe('generateBrief — 端到端：industry 是自由文本的旅游客户不被硬闸误清空', () => {
  it('🔴 生产库真实存量值 "Travel — Tour Operator" 也要保留行程信息，不当成非旅游客户清空', async () => {
    // 魏征实施后复审发现：裸字符串相等会漏判这种自由文本，生产库里
    // Kiwi Silk Road Travel (DEMO) 存的正是这个值。改用 hasIndustryFeature 后
    // 这里必须跟标准值 'travel' 走同一条路径。
    clientsRow = { name: 'Kiwi Silk Road Travel', industry: 'Travel — Tour Operator' }
    mockModelReply({
      ...BASE_REPLY_FIELDS,
      summary: '客户对 "Silk Road Explorer" 感兴趣。',
      customer_needs: ['了解更多关于 "Silk Road Explorer" 的信息'],
      trip: {
        tour_interest: 'Silk Road Explorer',
        travel_window: null,
        party_size: null,
        departure_city: null,
        first_time_to_china: null,
        budget_signal: null,
      },
      draft_reply: '',
    })

    const { brief } = await generateBrief(
      CTS_REAL_MESSAGES,
      'd0000000-0000-0000-0000-000000000002',
      undefined,
      NOT_ENTITLED_DEPS,
    )

    expect(brief.trip.tour_interest).toBe('Silk Road Explorer')
  })
})
