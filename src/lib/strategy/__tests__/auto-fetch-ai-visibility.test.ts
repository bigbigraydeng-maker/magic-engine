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
                    { question_id: 'q1', top3_brands: ['A', 'B', 'C'] },
                    { question_id: 'q2', top3_brands: ['D', 'E', 'F'] },
                    { question_id: 'q3', top3_brands: ['G', 'H', 'I'] },
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
    if (!result.ok) expect(result.reason).toMatch(/insufficient questions/)
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
                    { question_id: 'q1', top3_brands: ['CTS Tours', 'X', 'Y'] },          // hit (name)
                    { question_id: 'q2', top3_brands: ['Wendy Wu', '中国旅行社', 'Y'] },  // hit (alias)
                    { question_id: 'q3', top3_brands: ['Intrepid', 'cts tours', 'Y'] },   // hit (case-insensitive name)
                    { question_id: 'q4', top3_brands: ['Globus', 'Y', 'Z'] },             // miss
                    { question_id: 'q5', top3_brands: ['CTS Tours NZ Limited', 'Y'] },    // hit (substring)
                    { question_id: 'q6', top3_brands: ['Other'] },                        // miss
                    { question_id: 'q7', top3_brands: ['Other'] },                        // miss
                    { question_id: 'q8', top3_brands: ['Other'] },                        // miss
                    { question_id: 'q9', top3_brands: ['Other'] },                        // miss
                    { question_id: 'q10', top3_brands: ['Other'] },                       // miss
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
