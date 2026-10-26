// @vitest-environment node
/**
 * Regression suite for the mention-rate denominator.
 *
 * 红线：失败的探测不是一次"提及率为 0"的探测。These tests drive the real
 * aggregateSnapshot through runTracker and assert on what gets written to
 * ai_visibility_snapshots and flywheel_metrics.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runOpenAI: vi.fn(),
  parseRanking: vi.fn(),
  writeTrackerFlywheelMetrics: vi.fn(),
}))

vi.mock('../runners/openai', () => ({ runOpenAI: mocks.runOpenAI }))
vi.mock('../runners/claude', () => ({ runClaude: vi.fn() }))
vi.mock('../runners/perplexity', () => ({ runPerplexity: vi.fn() }))
vi.mock('../runners/gemini', () => ({ runGemini: vi.fn() }))
vi.mock('../parser', () => ({ parseRanking: mocks.parseRanking }))
vi.mock('../../flywheel/metrics/writeTrackerMetrics', () => ({
  writeTrackerFlywheelMetrics: mocks.writeTrackerFlywheelMetrics,
}))
vi.mock('../../supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { runTracker } from '../orchestrator'
import { supabaseAdmin } from '../../supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT_ID = '11111111-1111-4111-8111-111111111111'

interface WeekRow {
  id?: string
  ai_engine: string
  ai_model: string
  client_brand_rank: number | null
  brands_mentioned: Array<{ brand: string; rank: number }>
  error_message: string | null
  parse_error_message: string | null
}

const OK_RUNNER = {
  ai_engine: 'openai' as const,
  ai_model: 'gpt-5-search-api',
  raw_response: 'CTS Tours is a great operator.',
  citations: [],
  tokens_used: 100,
  cost_usd: 0.01,
  latency_ms: 500,
  error_message: null,
}

/** Captures what aggregateSnapshot upserts, and serves the week's rows paged. */
function wireTables(weekRows: WeekRow[]) {
  const upserts: Array<Record<string, unknown>> = []
  const PAGE = 1000

  const queryRows = [
    {
      id: 'query-1',
      client_id: CLIENT_ID,
      question: 'Who runs NZ tours?',
      source: 'manual',
      enabled: true,
      market_tag: 'nz',
      notes: null,
      created_at: '',
      updated_at: '',
    },
  ]

  mockFrom.mockImplementation((table: string) => {
    if (table === 'clients') {
      return promiseChain({
        data: {
          id: CLIENT_ID,
          name: 'CTS Tours',
          domain: 'ctstours.co.nz',
          brand_aliases: [],
          brand_geo_anchors: [],
        },
        error: null,
      }) as never
    }
    if (table === 'master_briefs') return promiseChain({ data: null, error: null }) as never
    if (table === 'ai_visibility_queries') {
      return promiseChain({ data: queryRows, error: null }) as never
    }
    if (table === 'ai_visibility_runs') {
      // insert(...).select('id').single() → a new row id; then .update(...) resolves ok.
      // select(...).range(from, to) → one page of the week's rows.
      let range: [number, number] = [0, PAGE - 1]
      const q: Record<string, unknown> = {
        insert: vi.fn(() => q),
        // update(...).eq(...) is awaited directly, so the chain itself resolves.
        update: vi.fn(() => q),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF, onR),
        select: vi.fn(() => q),
        eq: vi.fn(() => q),
        gte: vi.fn(() => q),
        order: vi.fn(() => q),
        single: vi.fn(() => Promise.resolve({ data: { id: 'run-1' }, error: null })),
        range: vi.fn((from: number, to: number) => {
          range = [from, to]
          return Promise.resolve({ data: weekRows.slice(range[0], range[1] + 1), error: null })
        }),
      }
      return q as never
    }
    if (table === 'ai_visibility_snapshots') {
      const q: Record<string, unknown> = {
        upsert: vi.fn((payload: Record<string, unknown>) => {
          upserts.push(payload)
          return q
        }),
        select: vi.fn(() => q),
        single: vi.fn(() => Promise.resolve({ data: { id: 'snapshot-1' }, error: null })),
      }
      return q as never
    }
    return promiseChain({ data: [], error: null }) as never
  })

  return { upserts }
}

function promiseChain(result: { data: unknown; error: { message: string } | null }) {
  const p = Promise.resolve(result)
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    in: vi.fn(() => q),
    single: vi.fn(() => p),
    maybeSingle: vi.fn(() => p),
    then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => p.then(onF, onR),
  }
  return q
}

function row(over: Partial<WeekRow> = {}): WeekRow {
  return {
    ai_engine: 'openai',
    ai_model: 'gpt-5-search-api',
    client_brand_rank: null,
    brands_mentioned: [],
    error_message: null,
    parse_error_message: null,
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.runOpenAI.mockResolvedValue(OK_RUNNER)
  mocks.parseRanking.mockResolvedValue({
    brands: [{ brand: 'CTS Tours', rank: 1 }],
    client_brand_rank: 1,
    parse_cost_usd: 0.001,
  })
})

describe('aggregateSnapshot — failed probes stay out of the denominator', () => {
  it('writes no snapshot and no metric when every stored run failed', async () => {
    // Acceptance case: a pass where nothing was measured must NOT publish a
    // 0% mention rate. The engine answered often enough for runs_succeeded to
    // be non-zero in other shapes; here the stored evidence is all failures.
    const { upserts } = wireTables([
      row({ error_message: 'Connection error.' }),
      row({ error_message: '429 Too Many Requests' }),
      row({ parse_error_message: 'LLM parse timeout' }),
    ])

    const result = await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    expect(upserts).toHaveLength(0)
    expect(mocks.writeTrackerFlywheelMetrics).not.toHaveBeenCalled()
    expect(result.snapshot_id).toBeNull()
    // The reason must name the real cause, not read as a system fault.
    expect(result.snapshot_skipped_reason).toContain('2 次引擎调用失败')
    expect(result.snapshot_skipped_reason).toContain('1 次结果解析失败')
    expect(result.snapshot_skipped_reason).toContain('这次没探测成')
  })

  it('still computes a mention rate from healthy data — the fix must not mute real signal', async () => {
    const { upserts } = wireTables([
      row({ client_brand_rank: 1, brands_mentioned: [{ brand: 'CTS Tours', rank: 1 }] }),
      row({ client_brand_rank: 3, brands_mentioned: [{ brand: 'CTS Tours', rank: 3 }] }),
      row({ ai_engine: 'google', ai_model: 'gemini-2.5-flash' }),
      row({ ai_engine: 'google', ai_model: 'gemini-2.5-flash' }),
    ])

    const result = await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ total_runs: 4, mentions_count: 2, avg_rank: 2 })
    expect(result.snapshot_skipped_reason).toBeNull()
    expect(mocks.writeTrackerFlywheelMetrics).toHaveBeenCalledWith(CLIENT_ID, {
      snapshotId: 'snapshot-1',
      mentionsCount: 2,
      totalRuns: 4,
      avgRank: 2,
      engineCoverage: 1,
    })
  })

  it('keeps a genuine miss in the denominator — an answer that named nobody is real evidence', async () => {
    // The opposite error to guard against: dropping every empty row would
    // leave only hits and report 100%.
    const { upserts } = wireTables([
      row({ client_brand_rank: 1, brands_mentioned: [{ brand: 'CTS Tours', rank: 1 }] }),
      row({ client_brand_rank: null, brands_mentioned: [{ brand: 'Rival Tours', rank: 1 }] }),
    ])

    await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    expect(upserts[0]).toMatchObject({ total_runs: 2, mentions_count: 1 })
  })

  it('drops only the failed rows from a mixed week', async () => {
    // 2 hits + 1 genuine miss measured, 2 rows never measured.
    // Before this fix: 2/5 = 40%. After: 2/3 = 67%.
    const { upserts } = wireTables([
      row({ client_brand_rank: 1, brands_mentioned: [{ brand: 'CTS Tours', rank: 1 }] }),
      row({ client_brand_rank: 2, brands_mentioned: [{ brand: 'CTS Tours', rank: 2 }] }),
      row({ client_brand_rank: null }),
      row({ error_message: 'Connection error.' }),
      row({ parse_error_message: 'bad JSON' }),
    ])

    await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    expect(upserts[0]).toMatchObject({ total_runs: 3, mentions_count: 2 })
  })

  it('counts a model as covered only when it actually answered', async () => {
    // gemini threw on every call: attempted, not covered. Publishing it in
    // models_covered would inflate GeoComposerAdapter's engine-coverage metric.
    const { upserts } = wireTables([
      row({ client_brand_rank: 1, brands_mentioned: [{ brand: 'CTS Tours', rank: 1 }] }),
      row({ ai_engine: 'google', ai_model: 'gemini-2.5-flash', error_message: 'quota exceeded' }),
    ])

    await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    expect(upserts[0]).toMatchObject({ models_covered: ['gpt-5-search-api'] })
  })

  it('keeps a failed run out of the ranking table', async () => {
    // A failed row carries an empty brand list today, but nothing in the
    // schema enforces that; the table must be built from measured rows only.
    const { upserts } = wireTables([
      row({ client_brand_rank: 1, brands_mentioned: [{ brand: 'CTS Tours', rank: 1 }] }),
      row({
        error_message: 'Connection error.',
        brands_mentioned: [{ brand: 'Ghost Tours', rank: 1 }],
      }),
    ])

    await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    const table = upserts[0].ranking_table as { brands: Array<{ name: string }> }
    expect(table.brands.map(b => b.name)).toEqual(['CTS Tours'])
  })

  it('reads past the 1000-row PostgREST cap instead of aggregating the first page', async () => {
    // CTS week of 2026-04-27 stored 1194 runs. An unpaged read would have
    // silently scored the first 1000 and called it the week.
    const hits = Array.from({ length: 600 }, () =>
      row({ client_brand_rank: 1, brands_mentioned: [{ brand: 'CTS Tours', rank: 1 }] })
    )
    const misses = Array.from({ length: 594 }, () => row())
    const { upserts } = wireTables([...hits, ...misses])

    await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    expect(upserts[0]).toMatchObject({ total_runs: 1194, mentions_count: 600 })
  })
})
