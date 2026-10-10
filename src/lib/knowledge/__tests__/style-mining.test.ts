/**
 * Tests for style/pattern mining (issue #1760).
 *
 * Split into pure-function tests (parsing/row-shaping, no I/O) and
 * orchestration tests (a dedicated in-memory `supabaseAdmin` fake, same
 * pattern as `__tests__/mining-orchestration.test.ts` — scoped to exactly
 * the query-builder surface this module calls).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseStyleExtractionResponse,
  stylePatternsToFactRows,
  extractStylePatterns,
  runStylePatternMining,
} from '../style-mining'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/anthropic/client', () => ({ callClaudeChat: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { callClaudeChat } from '@/lib/anthropic/client'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'

// ── parseStyleExtractionResponse ─────────────────────────────────────────

describe('parseStyleExtractionResponse', () => {
  it('parses a well-formed response, including supporting_indices', () => {
    const raw = JSON.stringify({
      patterns: [
        {
          pattern_key: 'greeting_warmth',
          category: 'tone',
          statement: 'Uses informal, warm greetings.',
          supporting_indices: [1, 3],
        },
        {
          pattern_key: 'shipping_delay',
          category: 'standard_response',
          statement: 'Always apologises then gives an ETA.',
          supporting_indices: [2, 5, 9],
        },
      ],
    })
    expect(parseStyleExtractionResponse(raw)).toEqual([
      { patternKey: 'greeting_warmth', category: 'tone', statement: 'Uses informal, warm greetings.', supportingIndices: [1, 3] },
      {
        patternKey: 'shipping_delay',
        category: 'standard_response',
        statement: 'Always apologises then gives an ETA.',
        supportingIndices: [2, 5, 9],
      },
    ])
  })

  it('returns an empty array when patterns is missing or not an array', () => {
    expect(parseStyleExtractionResponse(JSON.stringify({}))).toEqual([])
    expect(parseStyleExtractionResponse(JSON.stringify({ patterns: 'nope' }))).toEqual([])
  })

  it('defaults supporting_indices to [] when missing, and drops non-positive-integer entries from it', () => {
    const raw = JSON.stringify({
      patterns: [
        { pattern_key: 'no_indices', category: 'tone', statement: 'fine' },
        { pattern_key: 'junk_indices', category: 'tone', statement: 'fine', supporting_indices: [1, -2, 0, 'x', 3.5, 4] },
      ],
    })
    const result = parseStyleExtractionResponse(raw)
    expect(result[0].supportingIndices).toEqual([])
    expect(result[1].supportingIndices).toEqual([1, 4])
  })

  it('drops entries missing required fields or with an invalid category', () => {
    const raw = JSON.stringify({
      patterns: [
        { pattern_key: 'ok', category: 'tone', statement: 'fine', supporting_indices: [1] },
        { category: 'tone', statement: 'missing pattern_key' },
        { pattern_key: 'missing_statement', category: 'tone' },
        // 🔴 变异守卫：category 必须是 'tone' | 'standard_response' 之一——
        // 任何第三个值（哪怕看起来合理，如 'fact'）必须被丢弃，不能悄悄
        // 写进一个不属于这两个命名空间的 fact_key。
        { pattern_key: 'bad_category', category: 'fact', statement: 'wrong category' },
      ],
    })
    expect(parseStyleExtractionResponse(raw)).toEqual([
      { patternKey: 'ok', category: 'tone', statement: 'fine', supportingIndices: [1] },
    ])
  })

  it('tolerates minor JSON formatting issues via jsonrepair (same as mining.ts)', () => {
    const raw = "{ patterns: [{ pattern_key: 'ok', category: 'tone', statement: 'fine', supporting_indices: [1], }] }"
    expect(parseStyleExtractionResponse(raw)).toEqual([
      { patternKey: 'ok', category: 'tone', statement: 'fine', supportingIndices: [1] },
    ])
  })
})

// ── stylePatternsToFactRows ──────────────────────────────────────────────

const SAMPLE_5 = Array.from({ length: 5 }, (_, i) => ({
  sampleBody: `reply #${i + 1}`,
  precedingCustomerQuestion: null,
}))

describe('stylePatternsToFactRows', () => {
  it('namespaces tone → style.* and standard_response → response.*', () => {
    const rows = stylePatternsToFactRows(
      CLIENT_A,
      [
        { patternKey: 'greeting_warmth', category: 'tone', statement: 'Warm and informal.', supportingIndices: [1] },
        { patternKey: 'shipping_delay', category: 'standard_response', statement: 'Apology then ETA.', supportingIndices: [2] },
      ],
      SAMPLE_5,
    )
    expect(rows[0].fact_key).toBe('style.greeting_warmth')
    expect(rows[1].fact_key).toBe('response.shipping_delay')
  })

  it(
    '🔴 子牙+魏征复审 blocker: "tone" is always general, but "standard_response" is run through the same ' +
    'detectSensitivity() fact-mining uses — a "standard response" can be a policy/commitment wearing a ' +
    '"style" costume (issue #1760\'s own example: "客户问退款政策时通常这样回答"), and must not skip ' +
    "read.ts's customer dual-sign gate just because it was mined by this file instead of mining.ts",
    () => {
      const rows = stylePatternsToFactRows(
        CLIENT_A,
        [
          { patternKey: 'greeting', category: 'tone', statement: 'Uses warm, informal greetings.', supportingIndices: [1] },
          {
            patternKey: 'refund_policy_response',
            category: 'standard_response',
            statement: 'When asked about refunds, we always say a full refund requires the request within 7 days.',
            supportingIndices: [2, 3],
          },
          {
            patternKey: 'shipping_question',
            category: 'standard_response',
            statement: 'Confirms the item is in stock.',
            supportingIndices: [4],
          },
        ],
        SAMPLE_5,
      )
      // tone: never carries factual content — hardcoding is safe here.
      expect(rows[0].sensitivity).toBe('general')
      // standard_response that actually states a policy/timeline: must NOT be general.
      expect(rows[1].sensitivity).not.toBe('general')
      // standard_response with genuinely no price/timeline/commitment/policy content: general is correct here too.
      expect(rows[2].sensitivity).toBe('general')
    },
  )

  it('writes status=candidate, visibility=internal_only, source_kind=conversation_mining_style', () => {
    const rows = stylePatternsToFactRows(
      CLIENT_A,
      [{ patternKey: 'x', category: 'tone', statement: 'y', supportingIndices: [] }],
      SAMPLE_5,
    )
    expect(rows[0]).toMatchObject({
      client_id: CLIENT_A,
      status: 'candidate',
      visibility: 'internal_only',
      source_kind: 'conversation_mining_style',
      scope: {},
      structured_value: null,
      conflict_group_id: null,
    })
    expect(rows[0].evidence).toMatchObject({ templates_considered: 5, category: 'tone' })
  })

  it(
    '🔴 魏征复审: evidence carries the actual supporting template bodies (not just a count) so an FDE ' +
    'can check the claim against the real source instead of taking the model\'s word for it',
    () => {
      const rows = stylePatternsToFactRows(
        CLIENT_A,
        [{ patternKey: 'x', category: 'tone', statement: 'y', supportingIndices: [2, 4] }],
        SAMPLE_5,
      )
      const evidence = rows[0].evidence as Record<string, unknown>
      expect(evidence.supporting_samples).toEqual(['reply #2', 'reply #4'])
    },
  )

  it('ignores an out-of-range supporting index instead of throwing', () => {
    const rows = stylePatternsToFactRows(
      CLIENT_A,
      [{ patternKey: 'x', category: 'tone', statement: 'y', supportingIndices: [999] }],
      SAMPLE_5,
    )
    expect((rows[0].evidence as Record<string, unknown>).supporting_samples).toEqual([])
  })

  it('returns an empty array for an empty pattern list', () => {
    expect(stylePatternsToFactRows(CLIENT_A, [], [])).toEqual([])
  })
})

// ── extractStylePatterns ──────────────────────────────────────────────────

describe('extractStylePatterns', () => {
  beforeEach(() => {
    vi.mocked(callClaudeChat).mockReset()
  })

  it('makes no model call and returns empty for an empty sample', async () => {
    const result = await extractStylePatterns([])
    expect(result).toEqual({ patterns: [], costUsd: 0 })
    expect(callClaudeChat).not.toHaveBeenCalled()
  })

  it('makes exactly ONE model call regardless of sample size (corpus-level, not per-template)', async () => {
    vi.mocked(callClaudeChat).mockResolvedValue({
      text: JSON.stringify({ patterns: [] }),
      cost_usd: 0.002,
      input_tokens: 100,
      output_tokens: 20,
    })
    await extractStylePatterns([
      { sampleBody: 'reply 1', precedingCustomerQuestion: 'q1' },
      { sampleBody: 'reply 2', precedingCustomerQuestion: null },
      { sampleBody: 'reply 3', precedingCustomerQuestion: 'q3' },
    ])
    expect(callClaudeChat).toHaveBeenCalledTimes(1)
  })

  it('redacts PII from both the reply and the preceding question before they reach the prompt', async () => {
    vi.mocked(callClaudeChat).mockResolvedValue({
      text: JSON.stringify({ patterns: [] }),
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
    })
    await extractStylePatterns([
      { sampleBody: 'Contact me at ray@example.com', precedingCustomerQuestion: 'Call me on 021 234 5678' },
    ])
    const [[{ messages }]] = vi.mocked(callClaudeChat).mock.calls
    const prompt = messages[0].content as string
    expect(prompt).not.toContain('ray@example.com')
    expect(prompt).not.toContain('021 234 5678')
  })

  it(
    '🔴 魏征复审: redaction happens per-sample BEFORE joining into the multi-template prompt, so a PII ' +
    "pattern that straddles the boundary between one sample's tail and the next sample's `#N` label/head " +
    'never survives intact in the final prompt — the join glue itself must not accidentally re-form or hide it',
    async () => {
      vi.mocked(callClaudeChat).mockResolvedValue({
        text: JSON.stringify({ patterns: [] }),
        cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
      })
      await extractStylePatterns([
        { sampleBody: 'Call me on 021 234 5678', precedingCustomerQuestion: null },
        { sampleBody: 'Sure, happy to help with that.', precedingCustomerQuestion: 'My email is jane@example.co.nz' },
        { sampleBody: 'Reach me at 09 123 4567 anytime', precedingCustomerQuestion: null },
      ])
      const [[{ messages }]] = vi.mocked(callClaudeChat).mock.calls
      const prompt = messages[0].content as string
      expect(prompt).not.toContain('021 234 5678')
      expect(prompt).not.toContain('jane@example.co.nz')
      expect(prompt).not.toContain('09 123 4567')
      // Every sample is still present in redacted form, in order — the join
      // didn't silently drop a sample while redacting it.
      expect(prompt).toContain('#1')
      expect(prompt).toContain('#2')
      expect(prompt).toContain('#3')
  })

  it('returns the parsed patterns and the real cost from the model call', async () => {
    vi.mocked(callClaudeChat).mockResolvedValue({
      text: JSON.stringify({ patterns: [{ pattern_key: 'a', category: 'tone', statement: 'b' }] }),
      cost_usd: 0.0042,
      input_tokens: 500,
      output_tokens: 40,
    })
    const result = await extractStylePatterns([{ sampleBody: 'x', precedingCustomerQuestion: null }])
    expect(result.patterns).toEqual([{ patternKey: 'a', category: 'tone', statement: 'b', supportingIndices: [] }])
    expect(result.costUsd).toBe(0.0042)
  })
})

// ── runStylePatternMining (orchestration) ────────────────────────────────

type Row = Record<string, unknown>
interface Fixture {
  conversations: Row[]
  messages: Row[]
  facts: Row[]
  miningRuns: Row[]
}
let fixture: Fixture

function applyEq(rows: Row[], filters: Record<string, unknown>): Row[] {
  return rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
}

function outbound(body: string, sentAt: string, conversationId = 'conv-1'): Row {
  return { conversation_id: conversationId, direction: 'outbound', body, sent_at: sentAt }
}
function inbound(body: string, sentAt: string, conversationId = 'conv-1'): Row {
  return { conversation_id: conversationId, direction: 'inbound', body, sent_at: sentAt }
}

function fakeFrom(table: string): unknown {
  const filters: Record<string, unknown> = {}
  let inFilter: { key: string; values: unknown[] } | null = null
  let range: [number, number] | null = null
  let updatePayload: Row | null = null
  let upsertPayload: Row[] | null = null
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
    gt: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      range = [from, to]
      return builder
    },
    maybeSingle: () => {
      wantsMaybeSingle = true
      return builder
    },
    update: (payload: Row) => {
      updatePayload = payload
      return builder
    },
    upsert: (payload: Row[]) => {
      upsertPayload = payload
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
    if (updatePayload) {
      const target = table === 'client_knowledge_mining_runs' ? fixture.miningRuns : null
      if (!target) return { data: null, error: { message: `unexpected update on ${table}` } }
      for (const row of applyEq(target, filters)) Object.assign(row, updatePayload)
      return { data: null, error: null }
    }
    if (upsertPayload) {
      if (table !== 'client_knowledge_facts') return { data: null, error: { message: `unexpected upsert on ${table}` } }
      const inserted: Row[] = []
      for (const row of upsertPayload) {
        const dup = fixture.facts.find(
          (f) =>
            f.client_id === row.client_id &&
            f.fact_key === row.fact_key &&
            JSON.stringify(f.scope) === JSON.stringify(row.scope) &&
            f.value_fingerprint === row.value_fingerprint,
        )
        if (dup) continue
        const withId = { id: `fact-${fixture.facts.length + 1}`, ...row }
        fixture.facts.push(withId)
        inserted.push({ id: withId.id })
      }
      return { data: inserted, error: null }
    }
    if (table === 'conversations') {
      const rows = applyEq(fixture.conversations, filters)
      return { data: (range ? rows.slice(range[0], range[1] + 1) : rows).map((r) => ({ ...r })), error: null }
    }
    if (table === 'conversation_messages') {
      let rows = fixture.messages
      if (inFilter) rows = rows.filter((row) => inFilter!.values.includes(row[inFilter!.key]))
      rows = [...rows].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)))
      return { data: (range ? rows.slice(range[0], range[1] + 1) : rows).map((r) => ({ ...r })), error: null }
    }
    if (table === 'client_knowledge_mining_runs') {
      // upsertRunRow's initial INSERT has no filters/upsert/update set —
      // model it as a plain insert via the generic branch below.
      return { data: applyEq(fixture.miningRuns, filters).map((r) => ({ ...r })), error: null }
    }
    return { data: [], error: null }
  }

  // upsertRunRow always INSERTs (reclaimId is always null from this module —
  // it never reclaims a stale row, see file header). Model that here.
  builder.insert = (payload: Row) => {
    const withId = { id: `run-${fixture.miningRuns.length + 1}`, created_at: new Date().toISOString(), ...payload }
    fixture.miningRuns.push(withId)
    return {
      select: () => ({
        single: () => Promise.resolve({ data: { id: withId.id }, error: null }),
      }),
    }
  }
  return builder
}

function baseFixture(): Fixture {
  return { conversations: [{ id: 'conv-1', client_id: CLIENT_A }], messages: [], facts: [], miningRuns: [] }
}

const BUDGET = { maxMessages: 1000, maxSpendUsd: 1 }

beforeEach(() => {
  fixture = baseFixture()
  vi.mocked(supabaseAdmin.from).mockImplementation(fakeFrom as never)
  vi.mocked(callClaudeChat).mockReset()
})

describe('runStylePatternMining', () => {
  it('rejects a budget missing maxMessages or maxSpendUsd', async () => {
    await expect(runStylePatternMining(CLIENT_A, { maxMessages: 0, maxSpendUsd: 1 })).rejects.toThrow('maxMessages')
    await expect(runStylePatternMining(CLIENT_A, { maxMessages: 100, maxSpendUsd: 0 })).rejects.toThrow('maxSpendUsd')
  })

  it('skips with skipped_no_data when no template repeats across ≥2 conversations', async () => {
    fixture.messages = [
      outbound('one-off reply', '2026-01-01T00:00:00Z', 'conv-1'),
      inbound('a question', '2026-01-01T00:00:01Z', 'conv-1'),
    ]
    const receipt = await runStylePatternMining(CLIENT_A, BUDGET, 'req-1')
    expect(receipt.status).toBe('skipped_no_data')
    expect(callClaudeChat).not.toHaveBeenCalled()
  })

  it('writes candidate rows for a real repeated template and reports the receipt', async () => {
    fixture.conversations = [
      { id: 'conv-1', client_id: CLIENT_A },
      { id: 'conv-2', client_id: CLIENT_A },
    ]
    fixture.messages = [
      inbound('Do you ship to Auckland?', '2026-01-01T00:00:00Z', 'conv-1'),
      outbound('Hi! Yes we do, thanks for reaching out :)', '2026-01-01T00:00:01Z', 'conv-1'),
      inbound('Do you ship to Auckland?', '2026-01-02T00:00:00Z', 'conv-2'),
      outbound('Hi! Yes we do, thanks for reaching out :)', '2026-01-02T00:00:01Z', 'conv-2'),
    ]
    vi.mocked(callClaudeChat).mockResolvedValue({
      text: JSON.stringify({
        patterns: [{ pattern_key: 'friendly_greeting', category: 'tone', statement: 'Warm, uses emoji.' }],
      }),
      cost_usd: 0.003,
      input_tokens: 200,
      output_tokens: 20,
    })

    const receipt = await runStylePatternMining(CLIENT_A, BUDGET, 'req-2')

    expect(receipt.status).toBe('succeeded')
    expect(receipt.patternsWritten).toBe(1)
    expect(receipt.costUsd).toBe(0.003)
    expect(fixture.facts).toHaveLength(1)
    expect(fixture.facts[0]).toMatchObject({ fact_key: 'style.friendly_greeting', sensitivity: 'general', source_kind: 'conversation_mining_style' })
    const runRow = fixture.miningRuns.find((r) => r.request_id === 'req-2')
    expect(runRow).toMatchObject({ status: 'succeeded', candidates_found: 1 })
  })

  it(
    '🔴 idempotency: a second call with the SAME request_id after a succeeded run returns the ' +
    'cached receipt and makes no new model call',
    async () => {
      fixture.conversations = [
        { id: 'conv-1', client_id: CLIENT_A },
        { id: 'conv-2', client_id: CLIENT_A },
      ]
      fixture.messages = [
        inbound('q', '2026-01-01T00:00:00Z', 'conv-1'),
        outbound('reply', '2026-01-01T00:00:01Z', 'conv-1'),
        inbound('q', '2026-01-02T00:00:00Z', 'conv-2'),
        outbound('reply', '2026-01-02T00:00:01Z', 'conv-2'),
      ]
      vi.mocked(callClaudeChat).mockResolvedValue({
        text: JSON.stringify({ patterns: [{ pattern_key: 'a', category: 'tone', statement: 'b' }] }),
        cost_usd: 0.001,
        input_tokens: 10,
        output_tokens: 5,
      })

      const first = await runStylePatternMining(CLIENT_A, BUDGET, 'req-dupe')
      expect(first.status).toBe('succeeded')
      vi.mocked(callClaudeChat).mockClear()

      const second = await runStylePatternMining(CLIENT_A, BUDGET, 'req-dupe')
      expect(second.status).toBe('succeeded')
      expect(second.patternsWritten).toBe(first.patternsWritten)
      expect(callClaudeChat).not.toHaveBeenCalled()
      expect(fixture.facts).toHaveLength(1) // not written twice
    },
  )

  it('fails closed when the worst-case cost estimate exceeds the budget, without calling the model', async () => {
    fixture.conversations = [
      { id: 'conv-1', client_id: CLIENT_A },
      { id: 'conv-2', client_id: CLIENT_A },
    ]
    fixture.messages = [
      inbound('q', '2026-01-01T00:00:00Z', 'conv-1'),
      outbound('reply', '2026-01-01T00:00:01Z', 'conv-1'),
      inbound('q', '2026-01-02T00:00:00Z', 'conv-2'),
      outbound('reply', '2026-01-02T00:00:01Z', 'conv-2'),
    ]
    const receipt = await runStylePatternMining(CLIENT_A, { maxMessages: 1000, maxSpendUsd: 0.0000001 }, 'req-3')
    expect(receipt.status).toBe('failed')
    expect(receipt.error).toBe('estimated_cost_exceeds_budget')
    expect(callClaudeChat).not.toHaveBeenCalled()
  })
})
