/**
 * Unit tests for DAPE W2 zhuge memory loaders.
 *
 * Spec: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §3
 */
import { describe, it, expect, vi } from 'vitest'
import {
  loadIndustryBenchmarkSummary,
  loadZhugeFeedbackSummary,
  resolveClientSubIndustry,
  formatIndustryBenchmarkPrompt,
  formatZhugeFeedbackPrompt,
} from '../memory-loader'
import type { IndustryBenchmarkSummary, ZhugeFeedbackSummary } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

/**
 * Build a lightweight Supabase mock that returns canned results for the
 * `from(<table>)…` chain. Each table maps to a function that receives the
 * builder method calls so tests can assert on them.
 */
function makeMockSupabase(tableResults: Record<string, QueryResult>): {
  client: any
  fromCalls: string[]
  } {
  const fromCalls: string[] = []

  function makeBuilder(table: string) {
    const builder: any = {}
    const result = tableResults[table] ?? { data: null, error: null }

    // Chainable methods all return the same builder.
    for (const fn of ['select', 'eq', 'in', 'order', 'limit', 'not', 'gte', 'or']) {
      builder[fn] = vi.fn().mockReturnValue(builder)
    }
    // Terminal methods resolve to the canned result.
    builder.single = vi.fn().mockResolvedValue(result)
    builder.maybeSingle = vi.fn().mockResolvedValue(result)
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return builder
  }

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table)
      return makeBuilder(table)
    }),
  }
  return { client, fromCalls }
}

// ── resolveClientSubIndustry ──────────────────────────────────────────────────

describe('resolveClientSubIndustry()', () => {
  it('prefers sub_industry over industry', async () => {
    const { client } = makeMockSupabase({
      clients: { data: { industry: 'tourism_operator', sub_industry: 'inbound_tour_operator' }, error: null },
    })
    const result = await resolveClientSubIndustry(client as any, 'client-1')
    expect(result).toBe('inbound_tour_operator')
  })

  it('falls back to industry when sub_industry is missing', async () => {
    const { client } = makeMockSupabase({
      clients: { data: { industry: 'tourism_operator', sub_industry: null }, error: null },
    })
    const result = await resolveClientSubIndustry(client as any, 'client-1')
    expect(result).toBe('tourism_operator')
  })

  it('returns null when client row not found', async () => {
    const { client } = makeMockSupabase({
      clients: { data: null, error: null },
    })
    const result = await resolveClientSubIndustry(client as any, 'client-1')
    expect(result).toBeNull()
  })

  it('returns null when supabase errors (non-throwing)', async () => {
    const { client } = makeMockSupabase({
      clients: { data: null, error: { message: 'boom' } },
    })
    const result = await resolveClientSubIndustry(client as any, 'client-1')
    expect(result).toBeNull()
  })
})

// ── loadIndustryBenchmarkSummary ──────────────────────────────────────────────

describe('loadIndustryBenchmarkSummary()', () => {
  it('returns empty summary when no sub_industry', async () => {
    const { client } = makeMockSupabase({
      clients: { data: { industry: null, sub_industry: null }, error: null },
    })
    const summary = await loadIndustryBenchmarkSummary(client as any, 'client-1')
    expect(summary.has_content).toBe(false)
    expect(summary.dimensions).toHaveLength(0)
    expect(summary.sub_industry).toBeNull()
  })

  it('returns aggregated dimensions when rows present', async () => {
    const { client } = makeMockSupabase({
      clients: { data: { industry: 'tourism_operator', sub_industry: 'inbound_tour_operator' }, error: null },
      industry_benchmarks: {
        data: [
          { industry_category: 'inbound_tour_operator', dimension: 'seo',  score_p50: 30, score_p75: 50, score_p90: 70, typical_monthly_budget_aud: 1200, confidence: 0.8, source: 'live' },
          { industry_category: 'inbound_tour_operator', dimension: 'social', score_p50: 20, score_p75: 35, score_p90: 60, typical_monthly_budget_aud: 800,  confidence: 0.7, source: 'cache' },
        ],
        error: null,
      },
    })
    const summary = await loadIndustryBenchmarkSummary(client as any, 'client-1')
    expect(summary.has_content).toBe(true)
    expect(summary.sub_industry).toBe('inbound_tour_operator')
    expect(summary.dimensions).toHaveLength(2)
    expect(summary.dimensions[0].dimension).toBe('seo')
    expect(summary.dimensions[0].score_p75).toBe(50)
    expect(summary.dimensions[1].typical_monthly_budget_aud).toBe(800)
  })

  it('handles industry_benchmarks query error by returning empty summary with sub_industry', async () => {
    const { client } = makeMockSupabase({
      clients: { data: { industry: 'tourism_operator', sub_industry: 'inbound_tour_operator' }, error: null },
      industry_benchmarks: { data: null, error: { message: 'permission denied' } },
    })
    const summary = await loadIndustryBenchmarkSummary(client as any, 'client-1')
    expect(summary.has_content).toBe(false)
    expect(summary.sub_industry).toBe('inbound_tour_operator')
    expect(summary.dimensions).toHaveLength(0)
  })
})

// ── loadZhugeFeedbackSummary ──────────────────────────────────────────────────

describe('loadZhugeFeedbackSummary()', () => {
  it('returns empty when no events', async () => {
    const { client } = makeMockSupabase({
      zhuge_feedback_events: { data: [], error: null },
    })
    const summary = await loadZhugeFeedbackSummary(client as any, 'client-1')
    expect(summary.has_content).toBe(false)
    expect(summary.total).toBe(0)
    expect(summary.recent_events).toHaveLength(0)
  })

  it('counts feedback states correctly', async () => {
    const { client } = makeMockSupabase({
      zhuge_feedback_events: {
        data: [
          { suggestion_key: 'k1', suggestion_title: 'A', feedback_state: 'done',       created_at: '2026-06-01' },
          { suggestion_key: 'k1', suggestion_title: 'A', feedback_state: 'dismissed',  created_at: '2026-06-02' },
          { suggestion_key: 'k1', suggestion_title: 'A', feedback_state: 'dismissed',  created_at: '2026-06-03' },
          { suggestion_key: 'k2', suggestion_title: 'B', feedback_state: 'irrelevant', created_at: '2026-06-04' },
        ],
        error: null,
      },
    })
    const summary = await loadZhugeFeedbackSummary(client as any, 'client-1')
    expect(summary.has_content).toBe(true)
    expect(summary.total).toBe(4)
    expect(summary.state_counts.done).toBe(1)
    expect(summary.state_counts.dismissed).toBe(2)
    expect(summary.state_counts.irrelevant).toBe(1)
    // k1 dismissed twice → in dismissed_keys; k2 only once irrelevant → NOT in irrelevant_keys
    expect(summary.dismissed_keys).toContain('k1')
    expect(summary.irrelevant_keys).not.toContain('k2')
  })

  it('caps recent_events to 10', async () => {
    const data = Array.from({ length: 15 }, (_, i) => ({
      suggestion_key: `k${i}`,
      suggestion_title: `t${i}`,
      feedback_state: 'done' as const,
      created_at: `2026-06-${String(i + 1).padStart(2, '0')}`,
    }))
    const { client } = makeMockSupabase({
      zhuge_feedback_events: { data, error: null },
    })
    const summary = await loadZhugeFeedbackSummary(client as any, 'client-1')
    expect(summary.recent_events).toHaveLength(10)
  })

  it('does not throw when supabase returns error', async () => {
    const { client } = makeMockSupabase({
      zhuge_feedback_events: { data: null, error: { message: 'rls' } },
    })
    const summary = await loadZhugeFeedbackSummary(client as any, 'client-1')
    expect(summary.has_content).toBe(false)
  })
})

// ── formatIndustryBenchmarkPrompt ─────────────────────────────────────────────

describe('formatIndustryBenchmarkPrompt()', () => {
  it('returns empty string when summary missing', () => {
    expect(formatIndustryBenchmarkPrompt(undefined)).toBe('')
  })

  it('returns empty string when has_content is false', () => {
    const empty: IndustryBenchmarkSummary = {
      sub_industry: null,
      dimensions: [],
      has_content: false,
    }
    expect(formatIndustryBenchmarkPrompt(empty)).toBe('')
  })

  it('renders sub_industry and percentile anchors', () => {
    const summary: IndustryBenchmarkSummary = {
      sub_industry: 'inbound_tour_operator',
      has_content: true,
      dimensions: [
        { dimension: 'seo', score_p50: 30, score_p75: 50, score_p90: 70, typical_monthly_budget_aud: 1200, confidence: 0.8, source: 'live baseline_domains' },
      ],
    }
    const text = formatIndustryBenchmarkPrompt(summary)
    expect(text).toContain('Industry Memory (L2 — sub_industry=inbound_tour_operator)')
    expect(text).toContain('P50=30')
    expect(text).toContain('P75=50')
    expect(text).toContain('P90=70')
    expect(text).toContain('typical_budget_aud=1200')
    expect(text).toContain('live baseline_domains')
  })
})

// ── formatZhugeFeedbackPrompt ─────────────────────────────────────────────────

describe('formatZhugeFeedbackPrompt()', () => {
  it('returns empty string when summary missing', () => {
    expect(formatZhugeFeedbackPrompt(undefined)).toBe('')
  })

  it('returns empty string when total is zero', () => {
    const empty: ZhugeFeedbackSummary = {
      has_content: false,
      total: 0,
      state_counts: { done: 0, dismissed: 0, irrelevant: 0 },
      dismissed_keys: [],
      irrelevant_keys: [],
      recent_events: [],
    }
    expect(formatZhugeFeedbackPrompt(empty)).toBe('')
  })

  it('renders dismissed/irrelevant warning lines + recent events', () => {
    const summary: ZhugeFeedbackSummary = {
      has_content: true,
      total: 3,
      state_counts: { done: 1, dismissed: 1, irrelevant: 1 },
      dismissed_keys: ['publish_blog'],
      irrelevant_keys: ['fix_meta_titles'],
      recent_events: [
        { suggestion_key: 'publish_blog',   suggestion_title: 'Publish blog',       feedback_state: 'dismissed',  created_at: '2026-06-01' },
        { suggestion_key: 'fix_meta_titles', suggestion_title: 'Fix meta titles',   feedback_state: 'irrelevant', created_at: '2026-06-02' },
        { suggestion_key: 'social_post',    suggestion_title: 'Post on Instagram', feedback_state: 'done',       created_at: '2026-06-03' },
      ],
    }
    const text = formatZhugeFeedbackPrompt(summary)
    expect(text).toContain('Self-Feedback Loop (zhuge_feedback_events)')
    expect(text).toContain('done=1, dismissed=1, irrelevant=1')
    expect(text).toContain('DO NOT re-suggest: publish_blog')
    expect(text).toContain('re-frame or skip: fix_meta_titles')
    expect(text).toContain('publish_blog')
    expect(text).toContain('Post on Instagram')
  })
})
