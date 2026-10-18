import { describe, it, expect, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runSynthesis,
  summarizeSynthesis,
  type OrchestratorResult,
  type ModuleStatus,
} from '../synthesis-orchestrator'

// ---------------------------------------------------------------------------
// Fake supabase — records every filter call on diagnostic_runs.
// Any other table throws so no LLM / persistence work can sneak in.
// ---------------------------------------------------------------------------

interface RecordedFilter {
  method: 'eq' | 'neq' | 'gt' | 'gte'
  column: string
  value: string | number
}

interface FakeResponse {
  data: Array<{ id: string }> | null
  error: { message: string } | null
}

interface FakeSupabase {
  from: (table: string) => unknown
  /** Tables requested via from(), in order. */
  tables: string[]
  /** Filters recorded on the diagnostic_runs chain. */
  filters: RecordedFilter[]
  /** Number of times .limit() was called. */
  limitCalls: number
}

function makeFakeSupabase(response: FakeResponse): FakeSupabase {
  const fake: FakeSupabase = {
    tables: [],
    filters: [],
    limitCalls: 0,
    from(table: string) {
      fake.tables.push(table)
      if (table !== 'diagnostic_runs') {
        throw new Error(`unexpected table access: ${table}`)
      }

      // Chainable + awaitable builder.
      const builder = {
        select(_cols: string) {
          return builder
        },
        eq(column: string, value: string | number) {
          fake.filters.push({ method: 'eq', column, value })
          return builder
        },
        neq(column: string, value: string | number) {
          fake.filters.push({ method: 'neq', column, value })
          return builder
        },
        gt(column: string, value: string | number) {
          fake.filters.push({ method: 'gt', column, value })
          return builder
        },
        gte(column: string, value: string | number) {
          fake.filters.push({ method: 'gte', column, value })
          return builder
        },
        limit(_n: number) {
          fake.limitCalls += 1
          return builder
        },
        then(
          resolve: (value: FakeResponse) => void,
          reject?: (reason: unknown) => void,
        ) {
          return Promise.resolve(response).then(resolve, reject)
        },
      }
      return builder
    },
  }
  return fake
}

function asClient(fake: FakeSupabase): SupabaseClient {
  // Single cast — the fake only implements the surface the limiter touches.
  return fake as unknown as SupabaseClient
}

function findFilter(
  fake: FakeSupabase,
  method: RecordedFilter['method'],
  column: string,
): RecordedFilter | undefined {
  return fake.filters.find(f => f.method === method && f.column === column)
}

// ---------------------------------------------------------------------------
// Limiter tests
// ---------------------------------------------------------------------------

describe('runSynthesis — auto-run rate limiter', () => {
  it('skips with rate_limited_24h when the client already had a completed run with findings in the last 24h', async () => {
    const fake = makeFakeSupabase({ data: [{ id: 'run-1' }], error: null })

    const result = await runSynthesis(asClient(fake), {
      runId: 'run-2',
      clientId: 'client-1',
      resultMap: {},
      overallScore: 50,
    })

    expect(result.ran).toBe(false)
    expect(result.skipped_reason).toBe('rate_limited_24h')

    // Query shape: client_id, neq id, status completed, findings_count > 0, created_at >= cutoff.
    expect(findFilter(fake, 'eq', 'client_id')?.value).toBe('client-1')
    expect(findFilter(fake, 'neq', 'id')?.value).toBe('run-2')
    expect(findFilter(fake, 'eq', 'status')?.value).toBe('completed')
    expect(findFilter(fake, 'gt', 'findings_count')?.value).toBe(0)

    const cutoff = findFilter(fake, 'gte', 'created_at')?.value
    expect(typeof cutoff).toBe('string')
    const cutoffMs = new Date(cutoff as string).getTime()
    const now = Date.now()
    expect(cutoffMs).toBeGreaterThan(now - 25 * 60 * 60 * 1000)
    expect(cutoffMs).toBeLessThan(now - 23 * 60 * 60 * 1000)
  })

  it('is NOT limited by an empty diagnostic_narratives table', async () => {
    // Fake only knows diagnostic_runs; any diagnostic_narratives access throws.
    const fake = makeFakeSupabase({ data: [], error: null })

    const result = await runSynthesis(asClient(fake), {
      runId: 'run-2',
      clientId: 'client-1',
      resultMap: {},
      overallScore: 50,
    })

    // Passed the limiter (no prior run) and stopped at the findings check.
    expect(result.skipped_reason).toBe('no_findings_at_all')
    expect(fake.tables).toEqual(['diagnostic_runs'])
  })

  it('fails closed when the limiter query errors', async () => {
    const fake = makeFakeSupabase({ data: null, error: { message: 'boom' } })

    const result = await runSynthesis(asClient(fake), {
      runId: 'run-2',
      clientId: 'client-1',
      resultMap: {},
      overallScore: 50,
    })

    expect(result.ran).toBe(false)
    expect(result.skipped_reason).toBe('rate_limited_24h')
  })

  it('force bypasses the limiter', async () => {
    const fake = makeFakeSupabase({ data: [{ id: 'x' }], error: null })

    const result = await runSynthesis(asClient(fake), {
      runId: 'run-2',
      clientId: 'client-1',
      resultMap: {},
      overallScore: 50,
      force: true,
    })

    expect(result.skipped_reason).toBe('no_findings_at_all')
    // Limiter never queried diagnostic_runs.
    expect(fake.tables).not.toContain('diagnostic_runs')
  })

  it('DIAGNOSTIC_SYNTHESIS_ENABLED=false short-circuits before any query', async () => {
    const prev = process.env.DIAGNOSTIC_SYNTHESIS_ENABLED
    process.env.DIAGNOSTIC_SYNTHESIS_ENABLED = 'false'
    try {
      const fake = makeFakeSupabase({ data: [], error: null })

      const result = await runSynthesis(asClient(fake), {
        runId: 'run-2',
        clientId: 'client-1',
        resultMap: {},
        overallScore: 50,
      })

      expect(result.skipped_reason).toBe('disabled_by_env')
      expect(fake.tables).toEqual([])
    } finally {
      if (prev === undefined) delete process.env.DIAGNOSTIC_SYNTHESIS_ENABLED
      else process.env.DIAGNOSTIC_SYNTHESIS_ENABLED = prev
    }
  })
})

// ---------------------------------------------------------------------------
// summarizeSynthesis tests
// ---------------------------------------------------------------------------

const okModule: ModuleStatus = { state: 'ok', rows_written: 1, cost_usd: 0.05 }
const skippedModule: ModuleStatus = { state: 'skipped', reason: 'not attempted' }

function failedModule(error: string): ModuleStatus {
  return { state: 'failed', error }
}

function makeResult(overrides: Partial<OrchestratorResult>): OrchestratorResult {
  return {
    ran: true,
    modules: {
      score_explanations:   skippedModule,
      dimension_narratives: skippedModule,
      competitor_analysis:  skippedModule,
      market_context:       skippedModule,
    },
    total_cost_usd: 0,
    ...overrides,
  }
}

describe('summarizeSynthesis', () => {
  afterEach(() => {
    // No env mutation here, but keep the hook for symmetry / future use.
  })

  it('returns skipped when the orchestrator did not run', () => {
    const receipt = summarizeSynthesis({
      ran: false,
      skipped_reason: 'rate_limited_24h',
      modules: {
        score_explanations:   skippedModule,
        dimension_narratives: skippedModule,
        competitor_analysis:  skippedModule,
        market_context:       skippedModule,
      },
      total_cost_usd: 0,
    })

    expect(receipt.state).toBe('skipped')
    expect(receipt.skipped_reason).toBe('rate_limited_24h')
    expect(receipt.failed_modules).toEqual([])
    expect(receipt.errors).toEqual([])
    expect(receipt.total_cost_usd).toBe(0)
  })

  it('returns ok when all four modules succeeded', () => {
    const receipt = summarizeSynthesis(makeResult({
      modules: {
        score_explanations:   okModule,
        dimension_narratives: okModule,
        competitor_analysis:  okModule,
        market_context:       okModule,
      },
      total_cost_usd: 0.2,
    }))

    expect(receipt.state).toBe('ok')
    expect(receipt.failed_modules).toEqual([])
    expect(receipt.errors).toEqual([])
    expect(receipt.total_cost_usd).toBe(0.2)
  })

  it('returns partial when some modules ok and one failed', () => {
    const receipt = summarizeSynthesis(makeResult({
      modules: {
        score_explanations:   okModule,
        dimension_narratives: failedModule('LLM call failed (timeout). See server logs for details.'),
        competitor_analysis:  okModule,
        market_context:       skippedModule,
      },
      total_cost_usd: 0.1,
    }))

    expect(receipt.state).toBe('partial')
    expect(receipt.failed_modules).toEqual(['dimension_narratives'])
    expect(receipt.errors).toHaveLength(1)
    expect(receipt.errors[0].startsWith('dimension_narratives: ')).toBe(true)
  })

  it('returns failed when every attempted module failed', () => {
    const receipt = summarizeSynthesis(makeResult({
      modules: {
        score_explanations:   failedModule('boom'),
        dimension_narratives: failedModule('boom'),
        competitor_analysis:  skippedModule,
        market_context:       skippedModule,
      },
    }))

    expect(receipt.state).toBe('failed')
    expect(receipt.failed_modules).toEqual(['score_explanations', 'dimension_narratives'])
  })

  it('truncates error strings to 200 chars', () => {
    const longError = 'x'.repeat(500)
    const receipt = summarizeSynthesis(makeResult({
      modules: {
        score_explanations:   failedModule(longError),
        dimension_narratives: skippedModule,
        competitor_analysis:  skippedModule,
        market_context:       skippedModule,
      },
    }))

    expect(receipt.errors).toHaveLength(1)
    expect(receipt.errors[0].length).toBe(200)
    expect(receipt.errors[0].startsWith('score_explanations: ')).toBe(true)
  })
})
