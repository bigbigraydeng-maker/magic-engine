/**
 * Issue #1647 — brief.ts 去 CTS 化收尾 + CTS 历史事实迁移.
 *
 * Full integration against the REAL `getClientKnowledge` (not a stub), with
 * fixtures shaped exactly like migration
 * `20260915120000_brief_knowledge_migration_and_cts_history.sql`. This is
 * where the issue's headline acceptance criterion lives: prove CTS's
 * rendered system prompt still carries its real facts (0800 phone,
 * info@ctstours.co.nz, 25 years, the "never write 1928" correction, the
 * visa-free policy) once brief.ts reads them from the knowledge base instead
 * of the deleted `brief-client-facts.ts` literal — plus the two mutation
 * tests the issue calls out by name: the historical-grandfather bypass
 * actually working, and it actually expiring on 2026-10-15.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase, type Row } from '@/lib/knowledge/__tests__/fake-supabase'
import { getClientKnowledge } from '@/lib/knowledge/read'
import { buildSystemPrompt, type ClientIdentity } from '../brief'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CTS_IDENTITY: ClientIdentity = { name: 'CTS Tours NZ', industry: 'travel' }

const GRANDFATHER_DEADLINE = '2026-10-15T23:59:59+13:00'
const VISA_VALID_UNTIL = '2026-12-31T23:59:59+13:00'

const ENTITLEMENT_GRANT: Row = {
  client_id: CTS_CLIENT_ID,
  action_key: 'client_knowledge.read',
  mode: 'auto_approve',
  updated_by: 'migration:1647',
  effective_from: '2026-01-01T00:00:00.000Z',
  effective_to: null,
  metadata: { basis: 'fde_managed' },
}

/** Mirrors the four rows the migration inserts for CTS, one-to-one. */
const CTS_FACT_ROWS: Row[] = [
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
    id: 'c1000000-0000-0000-0000-000000000002',
    client_id: CTS_CLIENT_ID,
    fact_key: 'company.founding_year_correction',
    scope: {},
    statement:
      "Never state that this business was founded in 1928 or is New Zealand's oldest travel agency — 1928 refers to the China Travel Service group in China, unrelated to this New Zealand business.",
    structured_value: {
      wrong: '"since 1928", "in Auckland since 1928", or "New Zealand\'s oldest"',
      insteadSay:
        "1928 belongs to the China Travel Service group in China, not this New Zealand business — never state it as this company's own founding year.",
    },
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
  {
    id: 'c1000000-0000-0000-0000-000000000004',
    client_id: CTS_CLIENT_ID,
    fact_key: 'policy.visa_free_entry',
    scope: {},
    statement:
      'New Zealand passport holders can enter China visa-free for up to 30 days, until 31 December 2026. Do not state any other figure.',
    structured_value: { days: 30, valid_until: '2026-12-31' },
    conflict_group_id: null,
    status: 'approved',
    visibility: 'customer_ok',
    sensitivity: 'policy', // dual-sign category — this is the one that needs the grandfather bypass
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_until: VISA_VALID_UNTIL,
    last_verified_at: null,
    approved_by_email: 'migration:1647',
    approved_at: '2026-01-01T00:00:00.000Z',
    // 🔴 the point of this fixture: CTS was never taken through the normal
    // customer-confirmation flow for this fact — both fields stay null.
    client_confirmed_by_email: null,
    client_confirmed_at: null,
    client_confirmed_fingerprint: null,
    historical_confirmation_grandfather_until: GRANDFATHER_DEADLINE,
  },
]

/**
 * 🔴 issue #1648（阶段门）合并进来之后补的两张表：`getClientKnowledge`
 * 的 `customer_reply` 用途现在还要过 `isKnowledgeLiveForCustomerReply`
 * 这道闸（阶段=2 且 Governed Reply Agent 的 Messenger 开关打开），这个
 * fixture 写在阶段门功能存在之前，缺了这两张表会被 `createFakeSupabase`
 * 的"未建模表直接抛错"规则打回、`isKnowledgeLiveForCustomerReply` 吞掉那个
 * 错误变成 false，四条事实全被静默滤空——不是这份 fixture 本身错了，是
 * CTS 在这个回归测试要证明的场景（真实、已上线）现在必须显式声明成"阶段
 * 2 + Messenger 开关已开"，跟生产环境实际状态一致。
 */
function makeSb() {
  return createFakeSupabase({
    client_automation_policies: [ENTITLEMENT_GRANT],
    client_knowledge_facts: CTS_FACT_ROWS,
    client_knowledge_confirmers: [],
    // 🔴 issue #1648（rollout stage + channel gate）合并后 getClientKnowledge(customer_reply)
    // 新增了这一道闸：没有 phase=2 事件 + messenger 开关 = 默认落 stage 0（最不放行的默认值），
    // 这个 fixture 建于 #1648 之前，本就没设过这两张表。这里显式设成"已上线"，让本文件继续
    // 只测它原来要测的东西（宽限期/事实渲染），不被这道正交的新闸挡住——跟 read.test.ts 里
    // LIVE_PHASE_EVENT / MESSENGER_ENABLED_CLIENT 默认值的处理方式一致。
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
}

describe('CTS 知识库回归 — issue #1647 headline 验收标准', () => {
  it('🔴 宽限期内：customer_reply 读取拿到全部四条事实，渲染后的系统提示词保留全部原有内容', async () => {
    const sb = makeSb()
    const before = new Date('2026-09-20T00:00:00.000Z') // 宽限截止日 (2026-10-15) 之前
    const result = await getClientKnowledge(CTS_CLIENT_ID, { purpose: 'customer_reply' }, { supabase: sb, now: () => before })

    expect(result.entries).toHaveLength(4)

    const prompt = buildSystemPrompt(CTS_IDENTITY, result.entries)
    expect(prompt).toContain('operated in New Zealand for 25 years')
    expect(prompt).toContain('0800 287 888')
    expect(prompt).toContain('info@ctstours.co.nz')
    expect(prompt).toContain('visa-free for up to 30 days')
    expect(prompt).toContain('Never write "since 1928"')
    expect(prompt).not.toContain('New Asian Logistics')
  })

  it('🔴 变异测试：过了 2026-10-15 宽限截止日，免签政策事实自动从 customer_reply 撤出（其余三条不受影响）', async () => {
    const sb = makeSb()
    const after = new Date('2026-10-16T00:00:00.000Z') // 宽限截止日之后
    const result = await getClientKnowledge(CTS_CLIENT_ID, { purpose: 'customer_reply' }, { supabase: sb, now: () => after })

    const factKeys = result.entries.map((e) => e.factKey)
    expect(factKeys).not.toContain('policy.visa_free_entry')
    expect(factKeys).toEqual(
      expect.arrayContaining(['company.years_operating', 'company.founding_year_correction', 'support.escalation_contact']),
    )
    expect(result.entries).toHaveLength(3)

    const prompt = buildSystemPrompt(CTS_IDENTITY, result.entries)
    expect(prompt).not.toContain('visa-free for up to 30 days')
    // general 类事实不受宽限期影响，继续可用。
    expect(prompt).toContain('0800 287 888')
  })

  it('internal_brief 用途不受宽限/双签逻辑影响（那道闸只管 customer_reply）', async () => {
    const sb = makeSb()
    const after = new Date('2026-10-16T00:00:00.000Z')
    const result = await getClientKnowledge(CTS_CLIENT_ID, { purpose: 'internal_brief' }, { supabase: sb, now: () => after })
    // internal_brief 不走 isCustomerReplyEligible，四条全部可见（customer_ok 都在 internal_brief 允许范围内）。
    expect(result.entries).toHaveLength(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// read_failed 端到端（issue #1647 第 5 点）：knowledge 读取真的失败时，
// generateBrief 必须清空 draft_reply 并把 knowledgeStatus 报成 'read_failed'
// （由 storeBrief 落成 conversation_briefs.knowledge_status = 'read_failed'，
// brief-cycle.ts 的 shouldGenerateBrief 认得出这个状态要重试——见 brief.test.ts）。
// ─────────────────────────────────────────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ responses: { create: mockCreate } })),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { name: 'CTS Tours NZ', industry: 'travel' }, error: null }),
        }),
      }),
    }),
  },
}))

// generateBrief 必须在 loadClientIdentity 之后才读知识库 —— 这里用真实
// `@/lib/supabase` 供身份查询，用注入的 deps.knowledge.supabase 供知识库读取，
// 两条链路互不干扰（跟 knowledge/read.ts 本身对 supabaseAdmin 的懒加载方式一致）。
import { generateBrief } from '../brief'

describe('generateBrief — read_failed 端到端', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key'
  })

  it('🔴 知识库读取真的失败（DB 错误，不是未授权）：draft_reply 留空，knowledgeStatus 报 read_failed', async () => {
    const failingSb = createFakeSupabase(
      { client_automation_policies: [ENTITLEMENT_GRANT], client_knowledge_facts: [], client_knowledge_confirmers: [] },
      { errorTables: new Set(['client_knowledge_facts']) },
    )
    mockCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        summary: '客户询问行程。',
        intent_level: 'medium',
        customer_needs: ['了解行程'],
        objections: [],
        promises_made: [],
        next_action: null,
        follow_up_due_at: null,
        risk_flags: [],
        trip: {
          tour_interest: 'Christmas in China',
          travel_window: null,
          party_size: null,
          departure_city: null,
          first_time_to_china: null,
          budget_signal: null,
        },
        contact: { phone: null, email: null },
        // 模型自己写了一句回复——必须被代码层清空，不能信任模型自己判断
        // 知识库有没有读成功。
        draft_reply: 'Yes, we can confirm the tour details for you.',
      }),
    })

    const messages = [
      { direction: 'inbound' as const, senderName: 'Customer', body: 'Tell me about the Christmas tour', sentAt: '2026-09-15T00:00:00Z' },
    ]

    const { brief, knowledgeStatus } = await generateBrief(messages, CTS_CLIENT_ID, undefined, {
      knowledge: { supabase: failingSb },
    })

    expect(knowledgeStatus).toBe('read_failed')
    expect(brief.draft_reply).toBe('')
    // 其余字段不受影响——read_failed 只清空 draft_reply，不是整卡作废。
    expect(brief.customer_needs).toEqual(['了解行程'])
    expect(brief.trip.tour_interest).toBe('Christmas in China')
  })

  it('未授权（没有 entitlement grant）不是 read_failed——是正常的"没有这条事实"状态', async () => {
    const notEntitledSb = createFakeSupabase({
      client_automation_policies: [],
      client_knowledge_facts: [],
      client_knowledge_confirmers: [],
    })
    mockCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        summary: '客户询问行程。',
        intent_level: 'medium',
        customer_needs: [],
        objections: [],
        promises_made: [],
        next_action: null,
        follow_up_due_at: null,
        risk_flags: [],
        trip: {
          tour_interest: null,
          travel_window: null,
          party_size: null,
          departure_city: null,
          first_time_to_china: null,
          budget_signal: null,
        },
        contact: { phone: null, email: null },
        draft_reply: 'Thanks for reaching out!',
      }),
    })

    const messages = [{ direction: 'inbound' as const, senderName: 'Customer', body: 'Hi', sentAt: '2026-09-15T00:00:00Z' }]

    const { brief, knowledgeStatus } = await generateBrief(messages, CTS_CLIENT_ID, undefined, {
      knowledge: { supabase: notEntitledSb },
    })

    expect(knowledgeStatus).toBe('no_approved_facts')
    // 未授权不清空 draft_reply —— 这是本来就没有额外事实可用的正常状态，
    // 跟"读取失败，不知道有没有事实"是两件不同的事。
    expect(brief.draft_reply).toBe('Thanks for reaching out!')
  })
})
