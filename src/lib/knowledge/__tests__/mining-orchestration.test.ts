/**
 * Orchestration tests for `runKnowledgeMining` (issue #1645). Uses a
 * dedicated in-memory fake for `supabaseAdmin` — deliberately NOT the
 * narrow `fake-supabase.ts` used by read.ts/entitlement.ts tests, which only
 * models the limited query-builder surface those two modules call. Mining
 * additionally needs `.in()`/`.gt()`/`.range()`/`.single()`/`.upsert()`/
 * `.update()`/`.insert()`, so this fake is scoped to exactly what this file
 * exercises — same reasoning as that file's own header comment (an
 * unmodelled table must look like a bug, not like "this table is empty").
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runKnowledgeMining, estimateWorstCaseExtractionCostUsd, fetchMessagesSince } from '../mining'
import { KNOWLEDGE_READ_ACTION_KEY } from '../entitlement'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/anthropic/client', () => ({ callClaudeChat: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { callClaudeChat } from '@/lib/anthropic/client'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'

type Row = Record<string, unknown>

interface Fixture {
  policies: Row[]
  conversations: Row[]
  messages: Row[]
  facts: Row[]
  miningRuns: Row[]
}

let fixture: Fixture
let lastUpsertOnConflict: string | null

function baseFixture(): Fixture {
  return {
    policies: [
      {
        client_id: CLIENT_A,
        action_key: KNOWLEDGE_READ_ACTION_KEY,
        mode: 'auto_approve',
        updated_by: 'ray@magicengine.cloud',
        effective_from: '2026-01-01T00:00:00.000Z',
        effective_to: null,
        metadata: {},
      },
    ],
    conversations: [{ id: 'conv-1', client_id: CLIENT_A }],
    messages: [],
    facts: [],
    miningRuns: [],
  }
}

function outbound(body: string, sentAt: string, conversationId = 'conv-1'): Row {
  return { conversation_id: conversationId, direction: 'outbound', body, sent_at: sentAt }
}
function inbound(body: string, sentAt: string, conversationId = 'conv-1'): Row {
  return { conversation_id: conversationId, direction: 'inbound', body, sent_at: sentAt }
}

function applyEq(rows: Row[], filters: Record<string, unknown>): Row[] {
  return rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
}

function fakeFrom(table: string): unknown {
  const filters: Record<string, unknown> = {}
  let inFilter: { key: string; values: unknown[] } | null = null
  let gtFilter: { key: string; value: unknown } | null = null
  let orExpr: string | null = null
  let orderCol: string | null = null
  let orderDesc = false
  let limitN: number | null = null
  let range: [number, number] | null = null
  let insertPayload: Row | Row[] | null = null
  let updatePayload: Row | null = null
  let upsertPayload: Row[] | null = null
  let wantsSingle = false
  let wantsMaybeSingle = false

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (k: string, v: unknown) => {
      filters[k] = v
      return builder
    },
    in: (k: string, values: unknown[]) => {
      inFilter = { key: k, values }
      return builder
    },
    gt: (k: string, v: unknown) => {
      gtFilter = { key: k, value: v }
      return builder
    },
    or: (expr: string) => {
      orExpr = expr
      return builder
    },
    lte: () => builder,
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderCol = col
      orderDesc = opts?.ascending === false
      return builder
    },
    limit: (n: number) => {
      limitN = n
      return builder
    },
    range: (from: number, to: number) => {
      range = [from, to]
      return builder
    },
    single: () => {
      wantsSingle = true
      return builder
    },
    maybeSingle: () => {
      wantsMaybeSingle = true
      return builder
    },
    insert: (payload: Row | Row[]) => {
      insertPayload = payload
      return builder
    },
    update: (payload: Row) => {
      updatePayload = payload
      return builder
    },
    upsert: (payload: Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      upsertPayload = payload
      lastUpsertOnConflict = options?.onConflict ?? null
      return builder
    },
    then: (resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) => {
      const result = execute()
      if (wantsMaybeSingle && Array.isArray(result.data)) {
        return Promise.resolve({ data: result.data[0] ?? null, error: result.error }).then(resolve)
      }
      return Promise.resolve(result).then(resolve)
    },
  }

  function execute(): { data: unknown; error: { message: string } | null } {
    if (insertPayload) {
      const rows = Array.isArray(insertPayload) ? insertPayload : [insertPayload]
      const inserted = rows.map((row) => {
        const withId = { id: `${table}-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString(), ...row }
        if (table === 'client_knowledge_mining_runs') fixture.miningRuns.push(withId)
        else if (table === 'client_knowledge_facts') fixture.facts.push(withId)
        return withId
      })
      return { data: wantsSingle ? inserted[0] : inserted, error: null }
    }
    if (updatePayload) {
      const targetArrays = table === 'client_knowledge_mining_runs' ? fixture.miningRuns : table === 'client_knowledge_facts' ? fixture.facts : null
      if (!targetArrays) return { data: null, error: { message: `unexpected update on ${table}` } }
      const matches = applyEq(targetArrays, filters)
      for (const row of matches) Object.assign(row, updatePayload)
      return { data: null, error: null }
    }
    if (upsertPayload) {
      if (table !== 'client_knowledge_facts') return { data: null, error: { message: `unexpected upsert on ${table}` } }
      const inserted: Row[] = []
      for (const row of upsertPayload) {
        // Models the real unique index: (client_id, fact_key, scope,
        // value_fingerprint), unconditional on status. A row proposing a
        // genuinely different value_fingerprint never conflicts with an
        // existing row, even one with the identical (client_id, fact_key,
        // scope) — that's the whole point of including value_fingerprint in
        // the conflict target (see mining.ts's own comment on this upsert).
        const dup = fixture.facts.find(
          (f) =>
            f.client_id === row.client_id &&
            f.fact_key === row.fact_key &&
            JSON.stringify(f.scope) === JSON.stringify(row.scope) &&
            f.value_fingerprint === row.value_fingerprint,
        )
        if (dup) continue
        const withId = { id: `fact-${fixture.facts.length + 1}-${Math.random().toString(36).slice(2)}`, ...row }
        fixture.facts.push(withId)
        inserted.push({ id: withId.id })
      }
      return { data: inserted, error: null }
    }

    if (table === 'client_automation_policies') {
      let rows = applyEq(fixture.policies, filters)
      if (orExpr) {
        rows = rows.filter((row) => {
          const clauses = orExpr!.split(',')
          return clauses.some((clause) => {
            const [column, op, rawValue] = clause.split('.')
            const value = row[column]
            if (op === 'is' && rawValue === 'null') return value === null || value === undefined
            if (op === 'gt') return typeof value === 'string' && value > rawValue
            return false
          })
        })
      }
      if (orderCol) rows = [...rows].sort((a, b) => String(a[orderCol!]).localeCompare(String(b[orderCol!])))
      const sliced = limitN ? rows.slice(0, limitN) : rows
      return { data: sliced.map((r) => ({ ...r })), error: null }
    }
    if (table === 'conversations') {
      const rows = applyEq(fixture.conversations, filters)
      const sliced = range ? rows.slice(range[0], range[1] + 1) : rows
      return { data: sliced.map((r) => ({ ...r })), error: null }
    }
    if (table === 'conversation_messages') {
      let rows = fixture.messages
      if (inFilter) rows = rows.filter((row) => inFilter!.values.includes(row[inFilter!.key]))
      if (gtFilter) rows = rows.filter((row) => String(row[gtFilter!.key]) > String(gtFilter!.value))
      rows = [...rows].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)))
      const sliced = range ? rows.slice(range[0], range[1] + 1) : rows
      return { data: sliced.map((r) => ({ ...r })), error: null }
    }
    if (table === 'client_knowledge_facts') {
      const rows = applyEq(fixture.facts, filters)
      return { data: rows.map((r) => ({ ...r })), error: null }
    }
    if (table === 'client_knowledge_mining_runs') {
      let rows = applyEq(fixture.miningRuns, filters)
      rows = [...rows].sort((a, b) => (orderDesc ? -1 : 1) * String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
      const sliced = limitN ? rows.slice(0, limitN) : rows
      return { data: sliced.map((r) => ({ ...r })), error: null }
    }
    return { data: [], error: null }
  }

  return builder
}

function extractionResponse(isDealSpecific: boolean, facts: Row[] = [], costUsd = 0.001) {
  return { text: JSON.stringify({ is_deal_specific: isDealSpecific, facts }), cost_usd: costUsd, input_tokens: 100, output_tokens: 50 }
}

const REAL_MAIN_TEMPLATE =
  'Shipping rates\n' +
  '• Under 20 kg: NZD 4/kg\n' +
  '• 20 kg or more: NZD 2/kg\n' +
  'Service fees per shipment\n' +
  '• General goods: NZD 12\n' +
  '• Food products: NZD 24\n' +
  'Please note that food and general goods must be packed, shipped and charged separately.'

const BUDGET = { maxMessages: 1000, maxModelCalls: 10, maxSpendUsd: 1 }

let mockCallClaudeChat: ReturnType<typeof vi.fn>

beforeEach(() => {
  fixture = baseFixture()
  lastUpsertOnConflict = null
  vi.mocked(supabaseAdmin.from).mockImplementation(fakeFrom as never)
  mockCallClaudeChat = vi.mocked(callClaudeChat)
  mockCallClaudeChat.mockReset()
})

describe('runKnowledgeMining — request_id idempotency (safe against step retries)', () => {
  it('returns the existing receipt instead of erroring when called twice with the same request_id', async () => {
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z'), outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'))
    mockCallClaudeChat.mockResolvedValueOnce(extractionResponse(true, []))

    const first = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-retry-1')
    expect(first.status).toBe('succeeded')

    // Simulates an Inngest step retry re-invoking the same logical call with
    // the same idempotency key — must NOT try to insert a second row (which
    // would violate the real unique constraint on request_id) and must NOT
    // call the model again.
    const second = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-retry-1')
    expect(second.runId).toBe(first.runId)
    expect(second.status).toBe('succeeded')
    expect(mockCallClaudeChat).toHaveBeenCalledTimes(1) // not called again
    expect(fixture.miningRuns.filter((r) => r.request_id === 'req-retry-1')).toHaveLength(1) // no duplicate row
  })
})

// 🔴 事故预防回归测试（2026-09-14）：设计文档 §9.8（魏征 11）明确规定
// 萃取工作流不用 src/lib/mtc/budget-guard.ts——它管的是客户自己的 MTC
// 积分余额，不是 ME 付给模型供应商的钱，而且读失败会静默放行退回默认
// 上限，跟"缺任一硬顶就拒绝运行"的 fail-closed 原则矛盾。早期版本误引
// 用了这个模块（照着 issue 文本一句过时的话），已经删掉。这条测试锁死
// "不再引入这个依赖"，防止以后被误解成"复用现成预算闸"又加回来。
describe('runKnowledgeMining — does not depend on src/lib/mtc/budget-guard (design doc §9.8 explicitly forbids it)', () => {
  it('completes a run with no mtc/budget-guard mock registered at all', async () => {
    // 这条测试本身不能证明"没有调用 checkBudget"（这个 fake 对未建模的表
    // 一律返回空结果而不是抛错，真调了也未必炸）——真正的证据是源码里已
    // 经删掉了 `import { checkBudget } from '@/lib/mtc/budget-guard'` 这一
    // 行（对照本文件顶部也没有对应的 vi.mock）。这条测试只是回归锁：以后
    // 如果有人重新加回这个依赖但忘了在测试里也加对应 mock，这里会先炸。
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z'), outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'))
    mockCallClaudeChat.mockResolvedValueOnce(extractionResponse(true, []))
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-no-budget-guard')
    expect(receipt.status).toBe('succeeded')
  })
})

describe('runKnowledgeMining — happy path', () => {
  it('writes a candidate for a repeated, model-approved, number-verified template with real sensitivity classification', async () => {
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      inbound('what is the rate for parcels under 20kg?', '2026-01-01T00:00:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        {
          fact_key: 'rate.parcel.per_kg',
          scope: { service_line: 'parcel_sea' },
          statement: 'Under 20 kg: NZD 4/kg',
          structured_value: { unit: 'NZD/kg', under_kg: 20, rate: 4 },
        },
      ]),
    )

    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-happy-1')

    expect(receipt.status).toBe('succeeded')
    expect(receipt.candidatesWritten).toBe(1)
    expect(fixture.facts).toHaveLength(1)
    expect(fixture.facts[0]).toMatchObject({ status: 'candidate', client_id: CLIENT_A, visibility: 'internal_only' })
    // real detectSensitivity() classification, not a hardcoded placeholder —
    // a statement with a bare rate number and no policy/commitment/timeline
    // vocabulary classifies as 'price'.
    expect(fixture.facts[0].sensitivity).toBe('price')
    expect(fixture.facts[0].valid_until).toBeTruthy()
  })

  it('never writes anything but status="candidate"', async () => {
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z'), outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'))
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    await runKnowledgeMining(CLIENT_A, BUDGET, 'req-happy-2')
    expect(fixture.facts.every((f) => f.status === 'candidate')).toBe(true)
  })

  it('classifies a policy-worded candidate as sensitivity=policy, not the generic price default', async () => {
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    const policyTemplate = 'Refunds are only available within 7 days of purchase with original receipt.'
    fixture.messages.push(outbound(policyTemplate, '2026-01-01T00:01:00Z', 'conv-1'), outbound(policyTemplate, '2026-01-02T00:01:00Z', 'c2'))
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'policy.refund', scope: {}, statement: policyTemplate, structured_value: null },
      ]),
    )
    await runKnowledgeMining(CLIENT_A, BUDGET, 'req-policy')
    expect(fixture.facts[0]?.sensitivity).toBe('policy')
  })
})

describe('runKnowledgeMining — safety filters actually drop candidates', () => {
  it('drops a candidate the model marks deal-specific', async () => {
    fixture.messages.push(
      outbound('Freight: 138 kg × NZD 4 = NZD 552', '2026-01-01T00:01:00Z'),
      outbound('Freight: 138 kg × NZD 4 = NZD 552', '2026-01-02T00:01:00Z'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(true, [
        { fact_key: 'rate.x', scope: {}, statement: 'NZD 4 per kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-deal-1')
    expect(receipt.candidatesWritten).toBe(0)
    expect(receipt.dealSpecificSkipped).toBe(1)
  })

  it('drops a candidate that only occurred once, even if the model approves it', async () => {
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z'))
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-deal-2')
    expect(receipt.candidatesWritten).toBe(0)
    expect(receipt.dealSpecificSkipped).toBe(1)
  })

  it('drops a candidate sent 3 times but all to the SAME conversation (distinctConversationCount=1)', async () => {
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-03T00:01:00Z', 'conv-1'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-deal-3')
    expect(receipt.candidatesWritten).toBe(0)
    expect(receipt.dealSpecificSkipped).toBe(1)
  })

  it('drops a candidate whose number the source message never contained (hallucination)', async () => {
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 9/kg', structured_value: { unit: 'NZD/kg', rate: 9 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-prov-1')
    expect(receipt.candidatesWritten).toBe(0)
    expect(receipt.provenanceRejected).toBe(1)
  })
})

describe('runKnowledgeMining — budget enforcement (per-run hard caps)', () => {
  it('never calls the model more than maxModelCalls times', async () => {
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'conv-1'),
      outbound('Some other repeated template', '2026-01-03T00:01:00Z', 'c2'),
      outbound('Some other repeated template', '2026-01-04T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValue(extractionResponse(true, []))
    const receipt = await runKnowledgeMining(CLIENT_A, { maxMessages: 1000, maxModelCalls: 1, maxSpendUsd: 1 }, 'req-cap-1')
    expect(receipt.modelCallsUsed).toBe(1)
    expect(mockCallClaudeChat).toHaveBeenCalledTimes(1)
  })

  it('stops once the pre-call worst-case estimate for the NEXT call would exceed maxSpendUsd', async () => {
    const oneCallEstimate = estimateWorstCaseExtractionCostUsd(`${REAL_MAIN_TEMPLATE} `)
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'conv-1'),
      outbound('Some other repeated template', '2026-01-03T00:01:00Z', 'c2'),
      outbound('Some other repeated template', '2026-01-04T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValue(extractionResponse(true, [], oneCallEstimate))
    const receipt = await runKnowledgeMining(
      CLIENT_A,
      { maxMessages: 1000, maxModelCalls: 10, maxSpendUsd: oneCallEstimate * 1.5 },
      'req-cap-2',
    )
    expect(mockCallClaudeChat).toHaveBeenCalledTimes(1)
    expect(receipt.modelCallsUsed).toBe(1)
    expect(receipt.costUsd).toBeCloseTo(oneCallEstimate)
  })

  it('refuses to run at all with an incomplete budget', async () => {
    // @ts-expect-error deliberately missing maxSpendUsd
    await expect(runKnowledgeMining(CLIENT_A, { maxMessages: 500, maxModelCalls: 10 }, 'req-cap-3')).rejects.toThrow()
    expect(mockCallClaudeChat).not.toHaveBeenCalled()
  })
})

describe('runKnowledgeMining — incremental watermark (idempotent re-runs)', () => {
  it('only scans messages after the previous succeeded run’s high_watermark_at', async () => {
    fixture.miningRuns.push({
      id: 'prior-run',
      request_id: 'req-prior',
      client_id: CLIENT_A,
      status: 'succeeded',
      high_watermark_at: '2026-01-01T12:00:00Z',
      created_at: '2026-01-01T12:00:01Z',
    })
    fixture.messages.push(
      outbound('old message before watermark', '2026-01-01T00:00:00Z'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-03T00:01:00Z'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-watermark-1')
    expect(receipt.messagesScanned).toBe(2) // old message excluded
  })

  it('running twice over the SAME conversations does not double-write candidates or double-spend (idempotent)', async () => {
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValue(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const first = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-idem-1')
    expect(first.candidatesWritten).toBe(1)

    // Second run: watermark now excludes both messages already scanned —
    // no new messages, no new model calls, no new candidates.
    const second = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-idem-2')
    expect(second.messagesScanned).toBe(0)
    expect(second.candidatesWritten).toBe(0)
    expect(second.modelCallsUsed).toBe(0)
    expect(fixture.facts).toHaveLength(1) // still just the one candidate from the first run
  })
})

describe('runKnowledgeMining — conflict grouping against approved facts', () => {
  it('never silently drops a candidate that conflicts with an approved fact of the identical (fact_key, scope)', async () => {
    fixture.facts.push({
      id: 'approved-1',
      client_id: CLIENT_A,
      fact_key: 'rate.parcel.per_kg',
      scope: {},
      statement: 'Under 20 kg: NZD 4/kg',
      structured_value: { unit: 'NZD/kg', rate: 4 },
      status: 'approved',
      visibility: 'internal_only',
      sensitivity: 'general',
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: null,
      approved_by_email: 'fde@magicengine.cloud',
      approved_at: '2026-01-01T00:00:00Z',
      client_confirmed_by_email: null,
      client_confirmed_at: null,
      value_fingerprint: 'approved-fp',
    })
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound('Under 20 kg: NZD 9/kg', '2026-01-01T00:01:00Z', 'conv-1'),
      outbound('Under 20 kg: NZD 9/kg', '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.parcel.per_kg', scope: {}, statement: 'Under 20 kg: NZD 9/kg', structured_value: { unit: 'NZD/kg', rate: 9 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-conflict-1')
    expect(receipt.candidatesWritten).toBe(1)
    expect(receipt.conflictGroups).toBe(1)
    expect(fixture.facts).toHaveLength(2)
    const approvedRow = fixture.facts.find((f) => f.id === 'approved-1')
    const newRow = fixture.facts.find((f) => f.id !== 'approved-1')
    expect(approvedRow?.statement).toBe('Under 20 kg: NZD 4/kg') // untouched
    expect(newRow?.statement).toBe('Under 20 kg: NZD 9/kg') // exists as its own row
    expect(newRow?.conflict_group_id).toBeTruthy()
    expect(lastUpsertOnConflict).toBe('client_id,fact_key,scope,value_fingerprint')
  })

  it('links a new conflicting candidate to a conflict group from a prior, unreviewed mining run', async () => {
    fixture.facts.push({
      id: 'prior-candidate-1',
      client_id: CLIENT_A,
      fact_key: 'rate.parcel.per_kg',
      scope: {},
      statement: 'Under 20 kg: NZD 7/kg',
      structured_value: { unit: 'NZD/kg', rate: 7 },
      status: 'candidate',
      visibility: 'internal_only',
      sensitivity: 'price',
      valid_until: '2099-01-01T00:00:00Z',
      source_kind: 'conversation_mining',
      evidence: {},
      conflict_group_id: null,
      value_fingerprint: 'prior-fp',
    })
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound('Under 20 kg: NZD 6/kg', '2026-01-01T00:01:00Z', 'conv-1'),
      outbound('Under 20 kg: NZD 6/kg', '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.parcel.per_kg', scope: {}, statement: 'Under 20 kg: NZD 6/kg', structured_value: { unit: 'NZD/kg', rate: 6 } },
      ]),
    )
    await runKnowledgeMining(CLIENT_A, BUDGET, 'req-conflict-2')
    const priorRow = fixture.facts.find((f) => f.id === 'prior-candidate-1')
    const newRow = fixture.facts.find((f) => f.id !== 'prior-candidate-1')
    expect(priorRow?.conflict_group_id).toBeTruthy()
    expect(newRow?.conflict_group_id).toBe(priorRow?.conflict_group_id)
  })
})

describe('runKnowledgeMining — failure handling', () => {
  it('records a failed run and does not throw when the model call rejects', async () => {
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z'), outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'))
    mockCallClaudeChat.mockRejectedValueOnce(new Error('anthropic 503'))
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-fail-1')
    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('anthropic 503')
    const runRow = fixture.miningRuns.find((r) => r.id === receipt.runId)
    expect(runRow?.status).toBe('failed')
  })

  it('records a failed run when the client has no knowledge-base entitlement grant, WITHOUT spending any model calls first', async () => {
    // 子牙复审（2026-09-14）：entitlement 检查必须排在抽取循环之前——一个
    // 没有授权的客户不该先花钱跑完整个抽取循环才发现白跑。
    fixture.policies = [] // no grant at all
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(extractionResponse(false, []))
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-fail-2')
    expect(receipt.status).toBe('failed')
    expect(mockCallClaudeChat).not.toHaveBeenCalled()
    const runRow = fixture.miningRuns.find((r) => r.id === receipt.runId)
    expect(runRow?.status).toBe('failed')
  })
})

describe('runKnowledgeMining — crash recovery (子牙+魏征联合复审 2026-09-14)', () => {
  it('reclaims a run row stuck in "running" from a crashed prior attempt and actually retries, instead of returning a fabricated failure', async () => {
    // Simulates: a prior execution inserted the running row then crashed
    // before ever reaching a terminal status — exactly what happens if the
    // process dies between "insert running" and "update succeeded/failed".
    fixture.miningRuns.push({
      id: 'stale-run-1',
      request_id: 'req-crash-1',
      client_id: CLIENT_A,
      status: 'running',
      error: null,
      conversations_scanned: 0,
      messages_scanned: 0,
      candidates_found: 0,
      conflict_groups_found: 0,
      llm_cost_usd: null,
      created_at: '2026-01-01T00:00:00Z',
    })
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )

    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-crash-1')

    // The retry actually ran the real logic (called the model, wrote a
    // candidate) instead of just reporting a fake failure.
    expect(mockCallClaudeChat).toHaveBeenCalledTimes(1)
    expect(receipt.status).toBe('succeeded')
    expect(receipt.candidatesWritten).toBe(1)
    // The SAME row was reused (reclaimed), not a second row created for the
    // same request_id (which would violate the real unique constraint).
    expect(receipt.runId).toBe('stale-run-1')
    expect(fixture.miningRuns.filter((r) => r.request_id === 'req-crash-1')).toHaveLength(1)
    const reclaimedRow = fixture.miningRuns.find((r) => r.id === 'stale-run-1')
    expect(reclaimedRow?.status).toBe('succeeded')
    expect(reclaimedRow?.error).toBeFalsy()
  })

  it('reclaims a stuck "running" row even when the retry itself also fails, leaving a real error instead of a permanent silent zombie', async () => {
    fixture.miningRuns.push({
      id: 'stale-run-2',
      request_id: 'req-crash-2',
      client_id: CLIENT_A,
      status: 'running',
      error: null,
      conversations_scanned: 0,
      messages_scanned: 0,
      candidates_found: 0,
      conflict_groups_found: 0,
      llm_cost_usd: null,
      created_at: '2026-01-01T00:00:00Z',
    })
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z'), outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'))
    mockCallClaudeChat.mockRejectedValueOnce(new Error('anthropic 503 on retry'))

    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET, 'req-crash-2')

    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('anthropic 503 on retry')
    const reclaimedRow = fixture.miningRuns.find((r) => r.id === 'stale-run-2')
    // 🔴 This is the exact defect 子牙/魏征 found: before the fix, this row
    // would be left at status='running' with error=null forever, and the
    // returned receipt would claim 'failed' without that ever being true in
    // the database. Now the row itself is truthfully updated.
    expect(reclaimedRow?.status).toBe('failed')
    expect(reclaimedRow?.error).toContain('anthropic 503 on retry')
  })
})

describe('runKnowledgeMining — conflict_group_id backfill covers approved facts too (魏征复审 2026-09-14)', () => {
  it('backfills conflict_group_id onto the APPROVED row, not just the new candidate row', async () => {
    fixture.facts.push({
      id: 'approved-1',
      client_id: CLIENT_A,
      fact_key: 'rate.parcel.per_kg',
      scope: {},
      statement: 'Under 20 kg: NZD 4/kg',
      structured_value: { unit: 'NZD/kg', rate: 4 },
      status: 'approved',
      visibility: 'internal_only',
      sensitivity: 'general',
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: null,
      approved_by_email: 'fde@magicengine.cloud',
      approved_at: '2026-01-01T00:00:00Z',
      client_confirmed_by_email: null,
      client_confirmed_at: null,
      conflict_group_id: null,
      value_fingerprint: 'approved-fp',
    })
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound('Under 20 kg: NZD 9/kg', '2026-01-01T00:01:00Z', 'conv-1'),
      outbound('Under 20 kg: NZD 9/kg', '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.parcel.per_kg', scope: {}, statement: 'Under 20 kg: NZD 9/kg', structured_value: { unit: 'NZD/kg', rate: 9 } },
      ]),
    )
    await runKnowledgeMining(CLIENT_A, BUDGET, 'req-approved-backfill')
    const approvedRow = fixture.facts.find((f) => f.id === 'approved-1')
    const newRow = fixture.facts.find((f) => f.id !== 'approved-1')
    expect(approvedRow?.conflict_group_id).toBeTruthy()
    expect(approvedRow?.conflict_group_id).toBe(newRow?.conflict_group_id)
  })
})

describe(
  '🔴 fetchMessagesSince — chunks the conversationId `.in()` filter (issue #1760, real CTS 722-' +
  'conversation run hit a genuine "400 Bad Request" — one .in() with all 722 UUIDs overflows ' +
  "PostgREST's request-size limit; this affects the already-shipped runKnowledgeMining too, not " +
  'just the new style-mining caller)',
  () => {
    it('splits >1 chunk of conversationIds into multiple .in() queries and merges the results', async () => {
      const CHUNK_SIZE = 200 // must match mining.ts's CONVERSATION_ID_CHUNK_SIZE
      const conversationIds = Array.from({ length: CHUNK_SIZE + 5 }, (_, i) => `conv-${i}`)

      // One real message per conversation, deliberately shuffled so the
      // per-conversation-id ordering does NOT already happen to be
      // chronological — only a correct global sort after merging chunks
      // would catch a bug that returned chunk-local order instead.
      const messagesByConvo = new Map(
        conversationIds.map((id, i) => [
          id,
          { conversation_id: id, direction: 'inbound', body: `msg-${i}`, sent_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(Math.floor(i / 60)).padStart(3, '0')}Z` },
        ]),
      )
      // Force a real, verifiable chronological order independent of insertion/id order.
      const sortedByTime = [...messagesByConvo.values()].sort(() => Math.random() - 0.5)
      const chronological = [...sortedByTime].sort((a, b) => a.sent_at.localeCompare(b.sent_at))

      const inCalls: string[][] = []
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table !== 'conversation_messages') throw new Error(`unexpected table ${table}`)
        let idsForThisCall: string[] = []
        const chain: Record<string, unknown> = {
          select: () => chain,
          in: (_col: string, ids: string[]) => {
            idsForThisCall = ids
            inCalls.push(ids)
            return chain
          },
          order: () => chain,
          range: (from: number, to: number) => {
            const matched = sortedByTime.filter((m) => idsForThisCall.includes(m.conversation_id))
            const sortedMatched = [...matched].sort((a, b) => a.sent_at.localeCompare(b.sent_at))
            return { then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: sortedMatched.slice(from, to + 1), error: null }).then(resolve) }
          },
        }
        return chain as never
      })

      const result = await fetchMessagesSince(conversationIds, null, 10_000)

      // 🔴 变异守卫：必须真的分了不止一批——如果实现"忘了分块"，这条断言会失败
      // 而不是安静地通过（防止这条测试本身在没测到分块行为的情况下也能通过）。
      expect(inCalls.length).toBeGreaterThan(1)
      expect(inCalls.every((ids) => ids.length <= CHUNK_SIZE)).toBe(true)

      // 结果必须是全局按时间排序（不是"按分块各自排序后拼接"），且一条不漏。
      expect(result).toHaveLength(chronological.length)
      expect(result.map((m) => m.sentAt)).toEqual(chronological.map((m) => m.sent_at))
    })

    it(
      '🔴 子牙复审 BLOCKER: each chunk still honours maxMessages as an early-stop, not just a final ' +
      'slice — a chunk with far more messages than maxMessages must NOT be paginated to exhaustion ' +
      '(a client whose history vastly exceeds maxMessages must not be read in full)',
      async () => {
        // A single chunk (well under CHUNK_SIZE conversationIds) but with far
        // more than one page's worth of messages in it, and far more than
        // maxMessages — if the early-stop were silently dropped (as it was
        // before this fix), this chunk alone would need MULTIPLE .range()
        // calls to page through everything before the final slice trims it.
        const PAGE_SIZE = 1000
        const conversationIds = ['conv-a', 'conv-b']
        const hugeChunkMessages = Array.from({ length: PAGE_SIZE + 500 }, (_, i) => ({
          conversation_id: i % 2 === 0 ? 'conv-a' : 'conv-b',
          direction: 'inbound',
          body: `msg-${i}`,
          sent_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(Math.floor(i / 60)).padStart(3, '0')}Z`,
        }))

        let rangeCallCount = 0
        vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
          if (table !== 'conversation_messages') throw new Error(`unexpected table ${table}`)
          const sorted = [...hugeChunkMessages].sort((a, b) => a.sent_at.localeCompare(b.sent_at))
          const chain: Record<string, unknown> = {
            select: () => chain,
            in: () => chain,
            order: () => chain,
            range: (from: number, to: number) => {
              rangeCallCount += 1
              return { then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: sorted.slice(from, to + 1), error: null }).then(resolve) }
            },
          }
          return chain as never
        })

        const maxMessages = 50
        const result = await fetchMessagesSince(conversationIds, null, maxMessages)

        // Only ONE page should ever have been requested for this chunk — the
        // first page alone (1000 rows) already exceeds maxMessages (50), so
        // the inner loop must stop before requesting a second page.
        expect(rangeCallCount).toBe(1)
        expect(result).toHaveLength(maxMessages)
      },
    )
  },
)
