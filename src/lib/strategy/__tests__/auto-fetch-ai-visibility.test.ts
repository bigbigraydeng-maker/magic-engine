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
        if (table === 'industry_ai_visibility_questions') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [
                    { id: 'q1', platforms: ['chatgpt'] },
                    { id: 'q2', platforms: ['chatgpt'] },
                    { id: 'q3', platforms: ['chatgpt'] },
                  ],
                  error: null,
                }),
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
                    { question_id: 'q1', platform: 'chatgpt', top3_brands: ['A', 'B', 'C'], error_code: null },
                    { question_id: 'q2', platform: 'chatgpt', top3_brands: ['D', 'E', 'F'], error_code: null },
                    { question_id: 'q3', platform: 'chatgpt', top3_brands: ['G', 'H', 'I'], error_code: null },
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
    if (!result.ok) expect(result.reason).toMatch(/insufficient fully-measured AI visibility questions/)
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
        if (table === 'industry_ai_visibility_questions') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, platforms: ['chatgpt'] })),
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
                    platform: 'chatgpt',
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
      expect(result.label).toMatch(/0\/10 fully-measured/)
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
        if (table === 'industry_ai_visibility_questions') {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: Array.from({ length: 10 }, (_, i) => ({ id: `q${i + 1}`, platforms: ['chatgpt'] })),
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
                    { question_id: 'q1', platform: 'chatgpt', top3_brands: ['CTS Tours', 'X', 'Y'], error_code: null },          // hit (name)
                    { question_id: 'q2', platform: 'chatgpt', top3_brands: ['Wendy Wu', '中国旅行社', 'Y'], error_code: null },  // hit (alias)
                    { question_id: 'q3', platform: 'chatgpt', top3_brands: ['Intrepid', 'cts tours', 'Y'], error_code: null },   // hit (case-insensitive name)
                    { question_id: 'q4', platform: 'chatgpt', top3_brands: ['Globus', 'Y', 'Z'], error_code: null },             // miss
                    { question_id: 'q5', platform: 'chatgpt', top3_brands: ['CTS Tours NZ Limited', 'Y'], error_code: null },    // hit (substring)
                    { question_id: 'q6', platform: 'chatgpt', top3_brands: ['Other'], error_code: null },                        // miss
                    { question_id: 'q7', platform: 'chatgpt', top3_brands: ['Other'], error_code: null },                        // miss
                    { question_id: 'q8', platform: 'chatgpt', top3_brands: ['Other'], error_code: null },                        // miss
                    { question_id: 'q9', platform: 'chatgpt', top3_brands: ['Other'], error_code: null },                        // miss
                    { question_id: 'q10', platform: 'chatgpt', top3_brands: ['Other'], error_code: null },                       // miss
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
      expect(result.label).toMatch(/4\/10 fully-measured/)
    }
  })
})

/**
 * 2026-09-23 红线回归 (docs/PITFALLS.md D12, 第二处):
 * A probe that failed is NOT a measurement of zero. These tests are the
 * acceptance criteria for the fix — an all-failed collection must report
 * "not computable", and healthy data must still score normally.
 */
const PLATFORM_ORDER = ['chatgpt', 'google_ai_overview', 'google_serp']

/**
 * Assigns a platform to each row by occurrence order within its question_id
 * group (1st row → chatgpt, 2nd → google_ai_overview, 3rd → google_serp),
 * and derives the active-question config from that same assignment — so a
 * question with 3 rows in a test requires all 3 platforms, one with 1 row
 * requires only that platform, matching the pre-existing test semantics.
 */
function withPlatforms<T extends { question_id: string }>(
  rows: readonly T[],
): { rows: (T & { platform: string })[]; activeQuestions: { id: string; platforms: string[] }[] } {
  const seen = new Map<string, number>()
  const platformsByQuestion = new Map<string, string[]>()
  const platformedRows = rows.map(row => {
    const idx = seen.get(row.question_id) ?? 0
    seen.set(row.question_id, idx + 1)
    const platform = PLATFORM_ORDER[idx] ?? `platform_${idx}`
    const list = platformsByQuestion.get(row.question_id) ?? []
    list.push(platform)
    platformsByQuestion.set(row.question_id, list)
    return { ...row, platform }
  })
  const activeQuestions = [...platformsByQuestion.entries()].map(([id, platforms]) => ({ id, platforms }))
  return { rows: platformedRows, activeQuestions }
}

function stubSupabaseWithSnapshots(
  rawRows: Array<{ question_id: string; top3_brands: string[]; error_code: string | null }>,
  client: { name: string; industry: string; brand_aliases: string[] } = {
    name: 'CTS Tours', industry: 'travel', brand_aliases: [],
  },
) {
  const today = new Date().toISOString().slice(0, 10)
  const { rows, activeQuestions } = withPlatforms(rawRows)
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
      if (table === 'industry_ai_visibility_questions') {
        return {
          select: () => ({
            eq: () => ({ eq: async () => ({ data: activeQuestions, error: null }) }),
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
      expect(result.reason).toMatch(/insufficient fully-measured/)
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
      expect(result.label).toMatch(/2\/5 fully-measured/)
      expect(result.label).not.toMatch(/excluded/)
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
      expect(result.label).toMatch(/1\/5 fully-measured/)
    }
  })

  it('excludes partially-measured questions from BOTH numerator and denominator', async () => {
    // 6 questions fully measured on 2 platforms (2 hits), 4 questions where one
    // platform died. Old row-level fix: the 4 partials stayed in the denominator
    // as misses → 2/10 = 20. Complete-case: 2/6 = 33.
    const full = [
      { question_id: 'q1', top3_brands: ['CTS Tours'], error_code: null },
      { question_id: 'q1', top3_brands: ['Other'],     error_code: null },
      { question_id: 'q2', top3_brands: ['CTS Tours'], error_code: null },
      { question_id: 'q2', top3_brands: ['Other'],     error_code: null },
      ...['q3', 'q4', 'q5', 'q6'].flatMap(id => ([
        { question_id: id, top3_brands: ['Other'], error_code: null },
        { question_id: id, top3_brands: ['Other'], error_code: 'no_ai_overview' },
      ])),
    ]
    const partial = ['p1', 'p2', 'p3', 'p4'].flatMap(id => ([
      { question_id: id, top3_brands: ['Other'], error_code: null },
      { question_id: id, top3_brands: [] as string[], error_code: 'dataforseo_error' },
    ]))
    const result = await autoFetchMetricValue(
      stubSupabaseWithSnapshots([...full, ...partial]), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(33)        // 2 hits / 6 fully-measured, NOT 2/10
      expect(result.label).toMatch(/2\/6 fully-measured/)
      expect(result.label).toMatch(/4\/10 questions excluded/)
    }
  })

  it('never lets partial questions inflate the score to 100%', async () => {
    // Every non-hit question is partially measured. Keeping hits while dropping
    // their partial misses would yield 2/2 = 100. Complete-case + coverage gate
    // must refuse instead.
    const rows = [
      { question_id: 'h1', top3_brands: ['CTS Tours'], error_code: null },
      { question_id: 'h2', top3_brands: ['CTS Tours'], error_code: null },
      ...Array.from({ length: 8 }, (_, i) => i).flatMap(i => ([
        { question_id: `m${i}`, top3_brands: ['Other'], error_code: null },
        { question_id: `m${i}`, top3_brands: [] as string[], error_code: 'dataforseo_error' },
      ])),
    ]
    const result = await autoFetchMetricValue(stubSupabaseWithSnapshots(rows), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/insufficient fully-measured/)
  })

  it('refuses a thin-but-large-enough sample because probe failures are not random', async () => {
    // 6 fully measured (>= 5) out of 18 questions = 33% coverage, under the 60%
    // floor. City questions are the ones that fail, so the survivors skew
    // national — a biased sample, not merely a small one.
    const full = Array.from({ length: 6 }, (_, i) => ({
      question_id: `f${i}`, top3_brands: i === 0 ? ['CTS Tours'] : ['Other'], error_code: null,
    }))
    const dead = Array.from({ length: 12 }, (_, i) => ({
      question_id: `d${i}`, top3_brands: [] as string[], error_code: 'dataforseo_error',
    }))
    const result = await autoFetchMetricValue(
      stubSupabaseWithSnapshots([...full, ...dead]), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/coverage too low/)
      expect(result.reason).toMatch(/6\/18 questions \(33%\)/)
    }
  })
})

/**
 * Codex review on PR #1923 (2026-09-23): treating "every row currently in the
 * table is conclusive" as "fully measured" ignores that /api/baselines/ai-collect
 * accepts `limit` / `platforms`, and a cron batch can be killed mid-run. Either
 * way, `industry_ai_visibility_snapshots` can hold only a SLICE of the industry's
 * active question set for the day. These tests wire the active-question config
 * (`industry_ai_visibility_questions`) independently of what got written, so a
 * short/scoped run cannot read as complete coverage.
 */
describe('autoFetchMetricValue("ai_visibility_score") — validates against the active question config, not just written rows', () => {
  function stubWithActiveConfig(
    activeQuestions: Array<{ id: string; platforms: string[] }>,
    snapshotRows: Array<{ question_id: string; platform: string; top3_brands: string[]; error_code: string | null }>,
    client: { name: string; industry: string; brand_aliases: string[] } = {
      name: 'CTS Tours', industry: 'travel', brand_aliases: [],
    },
  ) {
    const today = new Date().toISOString().slice(0, 10)
    let callCount = 0
    return {
      from: (table: string) => {
        if (table === 'clients') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: client, error: null }) }) }) }
        }
        if (table === 'industry_ai_visibility_questions') {
          return {
            select: () => ({ eq: () => ({ eq: async () => ({ data: activeQuestions, error: null }) }) }),
          }
        }
        if (table === 'industry_ai_visibility_snapshots') {
          callCount++
          if (callCount === 1) {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({ maybeSingle: async () => ({ data: { collected_date: today }, error: null }) }),
                  }),
                }),
              }),
            }
          }
          return {
            select: () => ({ eq: () => ({ eq: async () => ({ data: snapshotRows, error: null }) }) }),
          }
        }
        return {} as any
      },
    } as any
  }

  it('treats a question absent from today\'s rows as not-fully-measured, not invisible', async () => {
    // Active config has 18 questions (the real industry set); today's batch
    // only wrote rows for 5 of them, e.g. via ?limit=5. Pre-fix, totalQuestions
    // was derived from the rows themselves, so this read as 5/5 = 100% coverage.
    const activeQuestions = Array.from({ length: 18 }, (_, i) => ({
      id: `q${i}`,
      platforms: ['chatgpt', 'google_ai_overview', 'google_serp'],
    }))
    const snapshotRows = Array.from({ length: 5 }, (_, i) => [
      { question_id: `q${i}`, platform: 'chatgpt', top3_brands: ['CTS Tours'], error_code: null },
      { question_id: `q${i}`, platform: 'google_ai_overview', top3_brands: ['CTS Tours'], error_code: null },
      { question_id: `q${i}`, platform: 'google_serp', top3_brands: ['CTS Tours'], error_code: null },
    ]).flat()

    const result = await autoFetchMetricValue(
      stubWithActiveConfig(activeQuestions, snapshotRows), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/coverage too low/)
      expect(result.reason).toMatch(/5\/18 questions \(28%\)/)
    }
  })

  it('treats a question probed on fewer platforms than its config requires as incomplete', async () => {
    // Active config requires 3 platforms per question; today's rows only cover
    // 1 platform (e.g. the batch ran with ?platforms=chatgpt). Pre-fix, a
    // question with only 1 row and that row conclusive read as fully measured.
    const activeQuestions = Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      platforms: ['chatgpt', 'google_ai_overview', 'google_serp'],
    }))
    const snapshotRows = Array.from({ length: 6 }, (_, i) => ({
      question_id: `q${i}`, platform: 'chatgpt', top3_brands: ['CTS Tours'], error_code: null,
    }))

    const result = await autoFetchMetricValue(
      stubWithActiveConfig(activeQuestions, snapshotRows), 'client-1', 'ai_visibility_score')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/insufficient fully-measured/)
  })
})
