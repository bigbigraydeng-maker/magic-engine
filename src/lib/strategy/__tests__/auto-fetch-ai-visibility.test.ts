import { describe, expect, it } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'

/**
 * Note: autoFetchMetricValue path contains multi-step Supabase chained queries.
 * We mock a simplified supabase client, covering all ok:false early-return branches.
 * ok:true real-value validation happens via cron integration tests (Task 5) + deploy SQL.
 */

function makeStubSupabase(handlers: Record<string, any>) {
  return {
    from: (table: string) => handlers[table] ?? handlers._default,
  } as any
}

describe('autoFetchMetricValue("ai_visibility_score") — error branches', () => {
  it('returns ok:false when client has no name', async () => {
    const sb = makeStubSupabase({
      clients: {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { name: null, industry: 'travel', brand_aliases: [] }, error: null }),
          }),
        }),
      },
    })
    const result = await autoFetchMetricValue(sb, 'client-1', 'ai_visibility_score')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/has no name/)
  })

  it('returns ok:false when industry not in mapping', async () => {
    const sb = makeStubSupabase({
      clients: {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { name: 'X', industry: 'cryptocurrency', brand_aliases: [] }, error: null }),
          }),
        }),
      },
    })
    const result = await autoFetchMetricValue(sb, 'client-1', 'ai_visibility_score')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/not mapped/)
  })

  it('returns ok:false when no snapshot exists for industry', async () => {
    const sb = makeStubSupabase({
      clients: {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { name: 'CTS Tours', industry: 'travel', brand_aliases: [] }, error: null }),
          }),
        }),
      },
      industry_ai_visibility_snapshots: {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      },
    })
    const result = await autoFetchMetricValue(sb, 'client-1', 'ai_visibility_score')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/no AI visibility snapshots/)
  })

  it('returns ok:false when latest snapshot is stale (< today)', async () => {
    // 魏征 v2 P1-2 — cron stale data guard
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const sb = makeStubSupabase({
      clients: {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { name: 'CTS Tours', industry: 'travel', brand_aliases: [] }, error: null }),
          }),
        }),
      },
      industry_ai_visibility_snapshots: {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { collected_date: yesterday }, error: null }),
              }),
            }),
          }),
        }),
      },
    })
    const result = await autoFetchMetricValue(sb, 'client-1', 'ai_visibility_score')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/not refreshed today/)
  })

  it('returns ok:false when question count < 5', async () => {
    const today = new Date().toISOString().slice(0, 10)
    // First snapshots query (get latestDate) returns today
    // Second snapshots query (get all today's snapshots) returns 3 unique questions (< 5)
    let callCount = 0
    const sb = {
      from: (table: string) => {
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { name: 'CTS Tours', industry: 'travel', brand_aliases: [] }, error: null }),
              }),
            }),
          }
        }
        if (table === 'industry_ai_visibility_snapshots') {
          callCount++
          if (callCount === 1) {
            // latestDate query
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { collected_date: today }, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          // second call: all snapshots today
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [
                    { question_id: 'q1', top3_brands: ['A', 'B', 'C'], error_code: null },
                    { question_id: 'q2', top3_brands: ['D', 'E', 'F'], error_code: null },
                    { question_id: 'q3', top3_brands: ['G', 'H', 'I'], error_code: null },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {} as any
      },
    } as any
    const result = await autoFetchMetricValue(sb, 'client-1', 'ai_visibility_score')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/insufficient conclusive AI visibility probes/)
  })

  it('returns ok:true with score 0 when brand not in any top3 (genuine zero)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    let callCount = 0
    const sb = {
      from: (table: string) => {
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { name: 'NotInResults', industry: 'travel', brand_aliases: [] },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'industry_ai_visibility_snapshots') {
          callCount++
          if (callCount === 1) {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { collected_date: today }, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: Array.from({ length: 10 }, (_, i) => ({
                    question_id: `q${i}`,
                    top3_brands: ['Wendy Wu', 'Intrepid', 'Globus'],
                    error_code: null,
                  })),
                  error: null,
                }),
              }),
            }),
          }
        }
        return {} as any
      },
    } as any
    const result = await autoFetchMetricValue(sb, 'client-1', 'ai_visibility_score')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(0)
      expect(result.label).toMatch(/0\/10/)
    }
  })

  it('returns ok:true with score 40 when brand matches 4/10 questions (top3 hit)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    let callCount = 0
    const sb = {
      from: (table: string) => {
        if (table === 'clients') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { name: 'CTS Tours', industry: 'travel', brand_aliases: ['中国旅行社'] },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'industry_ai_visibility_snapshots') {
          callCount++
          if (callCount === 1) {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { collected_date: today }, error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [
                    { question_id: 'q1', top3_brands: ['CTS Tours', 'X', 'Y'], error_code: null },          // hit (name)
                    { question_id: 'q2', top3_brands: ['Wendy Wu', '中国旅行社', 'Y'], error_code: null },  // hit (alias)
                    { question_id: 'q3', top3_brands: ['Intrepid', 'cts tours', 'Y'], error_code: null },   // hit (case-insensitive name)
                    { question_id: 'q4', top3_brands: ['Globus', 'Y', 'Z'], error_code: null },             // miss
                    { question_id: 'q5', top3_brands: ['CTS Tours NZ Limited', 'Y'], error_code: null },    // hit (substring)
                    { question_id: 'q6', top3_brands: ['Other'], error_code: null },                        // miss
                    { question_id: 'q7', top3_brands: ['Other'], error_code: null },                        // miss
                    { question_id: 'q8', top3_brands: ['Other'], error_code: null },                        // miss
                    { question_id: 'q9', top3_brands: ['Other'], error_code: null },                        // miss
                    { question_id: 'q10', top3_brands: ['Other'], error_code: null },                       // miss
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        return {} as any
      },
    } as any
    const result = await autoFetchMetricValue(sb, 'client-1', 'ai_visibility_score')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(40)
      expect(result.label).toMatch(/4\/10/)
    }
  })
})

/**
 * 2026-09-23 红线回归 (docs/PITFALLS.md D12, 第二处):
 * A probe that failed is NOT a measurement of zero. These tests are the
 * acceptance criteria for the fix — an all-failed collection must report
 * "not computable", and healthy data must still score normally.
 */
function stubSupabaseWithSnapshots(
  rows: Array<{ question_id: string; top3_brands: string[]; error_code: string | null }>,
  client: { name: string; industry: string; brand_aliases: string[] } = {
    name: 'CTS Tours', industry: 'travel', brand_aliases: [],
  },
) {
  const today = new Date().toISOString().slice(0, 10)
  let callCount = 0
  return {
    from: (table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: client, error: null }) }),
          }),
        }
      }
      if (table === 'industry_ai_visibility_snapshots') {
        callCount++
        if (callCount === 1) {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { collected_date: today }, error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        return {
          select: () => ({
            eq: () => ({ eq: async () => ({ data: rows, error: null }) }),
          }),
        }
      }
      return {} as any
    },
  } as any
}

describe('autoFetchMetricValue("ai_visibility_score") — failed probes are not zeros', () => {
  it('returns ok:false (NOT a low score) when every probe in the batch failed', async () => {
    // 18 questions, every single probe blew up — exactly the 2026-09-22 shape:
    // OpenAI credits exhausted + DataForSEO rejecting the request.
    const rows = Array.from({ length: 18 }, (_, i) => ({
      question_id: `q${i}`,
      top3_brands: [] as string[],
      error_code: i % 2 === 0 ? 'chatgpt_error' : 'dataforseo_error',
    }))
    const result = await autoFetchMetricValue(stubSupabaseWithSnapshots(rows), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/insufficient conclusive/)
      expect(result.reason).toMatch(/NOT COMPUTABLE, not zero/)
      // The reason must name the real cause so nobody reads it as "AI ignores us"
      expect(result.reason).toMatch(/chatgpt_error/)
      expect(result.reason).toMatch(/dataforseo_error/)
    }
  })

  it('still scores normally when every probe succeeded (no true signal suppressed)', async () => {
    const rows = [
      { question_id: 'q1', top3_brands: ['CTS Tours', 'X', 'Y'], error_code: null },
      { question_id: 'q2', top3_brands: ['CTS Tours', 'X', 'Y'], error_code: null },
      { question_id: 'q3', top3_brands: ['Wendy Wu', 'X', 'Y'],  error_code: null },
      { question_id: 'q4', top3_brands: ['Wendy Wu', 'X', 'Y'],  error_code: null },
      { question_id: 'q5', top3_brands: ['Wendy Wu', 'X', 'Y'],  error_code: null },
    ]
    const result = await autoFetchMetricValue(stubSupabaseWithSnapshots(rows), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(40)          // 2 hits / 5 questions
      expect(result.label).toMatch(/2\/5/)
      expect(result.label).not.toMatch(/probes failed/)
    }
  })

  it('counts no_ai_overview rows as genuine zeros, not as failures', async () => {
    // Google simply did not render an AI Overview — the brand really was absent.
    // Dropping these would bias the score UPWARD.
    const rows = [
      { question_id: 'q1', top3_brands: ['CTS Tours'], error_code: null },
      { question_id: 'q2', top3_brands: [] as string[], error_code: 'no_ai_overview' },
      { question_id: 'q3', top3_brands: [] as string[], error_code: 'no_ai_overview' },
      { question_id: 'q4', top3_brands: [] as string[], error_code: 'no_ai_overview' },
      { question_id: 'q5', top3_brands: [] as string[], error_code: 'no_ai_overview' },
    ]
    const result = await autoFetchMetricValue(stubSupabaseWithSnapshots(rows), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(20)          // 1 hit / 5 questions — denominator kept
      expect(result.label).toMatch(/1\/5/)
    }
  })

  it('excludes failed probes from the denominator instead of scoring the client down', async () => {
    // 5 conclusive (1 hit) + 5 failed. Old behaviour: 1/10 = 10. Correct: 1/5 = 20.
    const rows = [
      { question_id: 'q1', top3_brands: ['CTS Tours'], error_code: null },
      { question_id: 'q2', top3_brands: ['Other'], error_code: null },
      { question_id: 'q3', top3_brands: ['Other'], error_code: null },
      { question_id: 'q4', top3_brands: ['Other'], error_code: null },
      { question_id: 'q5', top3_brands: ['Other'], error_code: null },
      ...Array.from({ length: 5 }, (_, i) => ({
        question_id: `f${i}`, top3_brands: [] as string[], error_code: 'dataforseo_error',
      })),
    ]
    const result = await autoFetchMetricValue(stubSupabaseWithSnapshots(rows), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(20)
      // Partial coverage must be visible to whoever reads the number
      expect(result.label).toMatch(/5\/10 probes failed and were excluded/)
    }
  })
})
