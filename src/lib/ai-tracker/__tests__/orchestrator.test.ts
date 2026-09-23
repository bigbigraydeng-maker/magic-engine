// @vitest-environment node
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

type TableResult = { data: unknown; error: { message: string } | null }

/** A chainable query stub that also resolves like a promise, matching PostgREST's builder shape. */
function tableStub(result: TableResult) {
  const p = Promise.resolve(result)
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    insert: vi.fn(() => q),
    update: vi.fn(() => q),
    eq: vi.fn(() => q),
    in: vi.fn(() => q),
    is: vi.fn(() => q),
    gte: vi.fn(() => q),
    single: vi.fn(() => p),
    maybeSingle: vi.fn(() => p),
    then: (onF: (v: TableResult) => unknown, onR?: (e: unknown) => unknown) => p.then(onF, onR),
  }
  return q
}

function stubTables(map: Record<string, TableResult>) {
  const stubs: Record<string, ReturnType<typeof tableStub>> = {}
  for (const [table, result] of Object.entries(map)) stubs[table] = tableStub(result)
  mockFrom.mockImplementation((table: string) => {
    stubs[table] ??= tableStub({ data: [], error: null })
    return stubs[table] as never
  })
  return stubs
}

vi.mock('../../supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { runTracker } from '../orchestrator'
import { supabaseAdmin } from '../../supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const QUERY_ID = 'query-1'
const RUN_ID = 'run-1'

const runnerOut = {
  ai_engine: 'openai' as const,
  ai_model: 'gpt-5-search-api',
  raw_response: 'CTS Tours is a great operator.',
  citations: [],
  tokens_used: 100,
  cost_usd: 0.01,
  latency_ms: 500,
  error_message: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.runOpenAI.mockResolvedValue(runnerOut)

  stubTables({
    clients: { data: { id: CLIENT_ID, name: 'CTS Tours', domain: 'ctstours.co.nz', brand_aliases: [] }, error: null },
    master_briefs: { data: null, error: null },
    ai_visibility_queries: {
      data: [{ id: QUERY_ID, client_id: CLIENT_ID, question: 'Who runs NZ tours?', source: 'manual', enabled: true, market_tag: 'nz', notes: null, created_at: '', updated_at: '' }],
      error: null,
    },
  })
})

describe('runTracker — parse-failure update path', () => {
  it('records a DB update failure instead of silently dropping it (regression for the missing parse_error_message column)', async () => {
    mocks.parseRanking.mockRejectedValue(new Error('LLM parse timeout'))

    const stubs = stubTables({
      clients: { data: { id: CLIENT_ID, name: 'CTS Tours', domain: 'ctstours.co.nz', brand_aliases: [] }, error: null },
      master_briefs: { data: null, error: null },
      ai_visibility_queries: {
        data: [{ id: QUERY_ID, client_id: CLIENT_ID, question: 'Who runs NZ tours?', source: 'manual', enabled: true, market_tag: 'nz', notes: null, created_at: '', updated_at: '' }],
        error: null,
      },
    })
    // ai_visibility_runs: insert succeeds (returns the new row id), then the
    // follow-up update fails — this is exactly what happens in production
    // when parse_error_message is included in the payload but the column
    // does not exist on the table.
    const runsStub = tableStub({ data: null, error: null })
    runsStub.insert = vi.fn(() => runsStub)
    runsStub.select = vi.fn(() => runsStub)
    runsStub.single = vi.fn(() => Promise.resolve({ data: { id: RUN_ID }, error: null }))
    runsStub.update = vi.fn(() =>
      Object.assign(runsStub, {
        then: (onF: (v: TableResult) => unknown) =>
          Promise.resolve({ data: null, error: { message: 'column ai_visibility_runs.parse_error_message does not exist' } }).then(onF),
      })
    )
    mockFrom.mockImplementation((table: string) => (table === 'ai_visibility_runs' ? runsStub : (stubs[table] ?? tableStub({ data: [], error: null }))) as never)

    const result = await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    // The failure must be visible on the result, not swallowed. Two errors
    // are expected: the original parser failure, and — this is the
    // regression this test guards — the DB update rejection that used to
    // be discarded silently.
    expect(result.runs_failed).toBe(1)
    expect(result.runs_succeeded).toBe(0)
    expect(result.errors).toHaveLength(2)
    const updateFailure = result.errors.find(e => e.message.includes('DB update failed'))
    expect(updateFailure).toMatchObject({ query_id: QUERY_ID, engine: 'openai' })
    expect(updateFailure?.message).toContain('parse_error_message does not exist')
  })

  it('still counts the run as succeeded when the update itself succeeds', async () => {
    mocks.parseRanking.mockResolvedValue({ brands: [{ brand: 'CTS Tours', rank: 1 }], client_brand_rank: 1, parse_cost_usd: 0.001 })

    const runsStub = tableStub({ data: null, error: null })
    runsStub.insert = vi.fn(() => runsStub)
    runsStub.select = vi.fn(() => runsStub)
    runsStub.single = vi.fn(() => Promise.resolve({ data: { id: RUN_ID }, error: null }))
    runsStub.update = vi.fn(() =>
      Object.assign(runsStub, {
        then: (onF: (v: TableResult) => unknown) => Promise.resolve({ data: null, error: null }).then(onF),
      })
    )
    mockFrom.mockImplementation((table: string) => {
      if (table === 'ai_visibility_runs') return runsStub as never
      if (table === 'clients') return tableStub({ data: { id: CLIENT_ID, name: 'CTS Tours', domain: 'ctstours.co.nz', brand_aliases: [] }, error: null }) as never
      if (table === 'master_briefs') return tableStub({ data: null, error: null }) as never
      if (table === 'ai_visibility_queries') {
        return tableStub({
          data: [{ id: QUERY_ID, client_id: CLIENT_ID, question: 'Who runs NZ tours?', source: 'manual', enabled: true, market_tag: 'nz', notes: null, created_at: '', updated_at: '' }],
          error: null,
        }) as never
      }
      // ai_visibility_snapshots (aggregateSnapshot) — no runs this week, aggregate returns null.
      return tableStub({ data: [], error: null }) as never
    })

    const result = await runTracker({ client_id: CLIENT_ID, engines: ['openai'] })

    expect(result.runs_succeeded).toBe(1)
    expect(result.runs_failed).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})
