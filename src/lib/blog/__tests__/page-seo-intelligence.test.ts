/**
 * Tests for fetchGeoGaps inside page-seo-intelligence.ts.
 *
 * The GEO gap list feeds weakness signals straight into the page-upgrade
 * prompt, so a gap that is really "the provider never answered" turns into a
 * content prescription built on a measurement nobody took.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { getPageSeoIntelligence } from '../page-seo-intelligence'

const mockFrom = vi.mocked(supabaseAdmin.from)

/**
 * Every call made on a fluent chain, as `method(arg, arg)` strings.
 *
 * The stub below answers every method, so it cannot fail a query the way the
 * database would — which means a test that only inspects the returned rows
 * proves nothing about the SQL. Recording the calls lets the SQL half be
 * asserted directly. Verified by mutation on 2026-09-23: deleting the
 * `.is(...)` filters from the source left the row-level assertions green.
 */
let chainCalls: string[] = []

/** Fluent-chain stub: every method returns itself, awaiting resolves the value. */
function chain(resolved: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolved)
  const handler: ProxyHandler<typeof promise> = {
    get(target, prop) {
      if (prop in target || typeof prop === 'symbol') {
        const val = (target as unknown as Record<string | symbol, unknown>)[prop]
        return typeof val === 'function' ? val.bind(target) : val
      }
      return (...args: unknown[]) => {
        chainCalls.push(`${String(prop)}(${args.map(a => JSON.stringify(a)).join(', ')})`)
        return new Proxy(promise, handler)
      }
    },
  }
  return new Proxy(promise, handler) as unknown as ReturnType<typeof supabaseAdmin.from>
}

interface RunRow {
  client_brand_rank: number | null
  error_message: string | null
  parse_error_message: string | null
  query: { question: string }
}

function run(partial: Partial<RunRow> & { question: string }): RunRow {
  return {
    client_brand_rank: partial.client_brand_rank ?? null,
    error_message: partial.error_message ?? null,
    parse_error_message: partial.parse_error_message ?? null,
    query: { question: partial.question },
  }
}

/**
 * serp_rankings is asked for a latest date first (returns nothing here, so the
 * SERP branch short-circuits), then ai_visibility_snapshots, then
 * ai_visibility_runs. Both branches run under Promise.allSettled, so wire the
 * mock by table name rather than call order.
 */
function setupTables(runs: RunRow[], avgRank: number | null = 4.2) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'serp_rankings') return chain({ data: null, error: null })
    if (table === 'ai_visibility_snapshots') return chain({ data: { avg_rank: avgRank }, error: null })
    return chain({ data: runs, error: null })
  })
}

describe('getPageSeoIntelligence — GEO gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chainCalls = []
  })

  it('asks the database to exclude failed probes, not just filters them after', async () => {
    // The row limit is spent on whatever the database returns, so a filter that
    // only runs in memory lets 50 failed probes crowd out the real gaps.
    setupTables([run({ question: 'anything' })])
    await getPageSeoIntelligence('client-1', 'https://example.com/tours')

    expect(chainCalls).toContain('is("error_message", null)')
    expect(chainCalls).toContain('is("parse_error_message", null)')
    // And the columns the predicate needs must actually be selected.
    expect(chainCalls.some(c => c.startsWith('select(') && c.includes('error_message'))).toBe(true)
  })

  it('reports a real gap: the AI answered and did not mention the client', async () => {
    setupTables([run({ question: 'best china tours nz' })])
    const result = await getPageSeoIntelligence('client-1', 'https://example.com/tours')
    expect(result.geo_gaps).toEqual([{ question: 'best china tours nz', brand_rank: null }])
  })

  it('reports a real gap: the client ranked outside the top 3', async () => {
    setupTables([run({ question: 'nz tour operators', client_brand_rank: 7 })])
    const result = await getPageSeoIntelligence('client-1', 'https://example.com/tours')
    expect(result.geo_gaps).toEqual([{ question: 'nz tour operators', brand_rank: 7 }])
  })

  it('does not report a probe the provider never answered as a gap', async () => {
    setupTables([
      run({ question: 'china holidays nz', error_message: 'GoogleGenerativeAI fetch failed' }),
      run({ question: 'nz travel agents', error_message: '429 no credits remaining' }),
    ])
    const result = await getPageSeoIntelligence('client-1', 'https://example.com/tours')
    expect(result.geo_gaps).toEqual([])
    // weakness_signals is what actually reaches the Claude prompt, so assert on
    // it too — geo_gaps being empty is not the same as the prompt staying quiet.
    expect(result.weakness_signals.join(' ')).not.toContain('china holidays nz')
    expect(result.weakness_signals.join(' ')).not.toContain('nz travel agents')
  })

  it('says nothing about GEO in the prompt when no snapshot and no conclusive run exist', async () => {
    setupTables([run({ question: 'china holidays nz', error_message: 'provider down' })], null)
    const result = await getPageSeoIntelligence('client-1', 'https://example.com/tours')
    expect(result.has_geo_data).toBe(false)
    expect(result.weakness_signals.some(sig => sig.startsWith('GEO'))).toBe(false)
  })

  it('does not report a probe whose parser failed as a gap', async () => {
    setupTables([run({ question: 'china holidays nz', parse_error_message: 'LLM parse timeout' })])
    const result = await getPageSeoIntelligence('client-1', 'https://example.com/tours')
    expect(result.geo_gaps).toEqual([])
  })

  it('keeps the real gaps when failures sit alongside them', async () => {
    setupTables([
      run({ question: 'unreachable question', error_message: 'provider down' }),
      run({ question: 'real gap question' }),
    ])
    const result = await getPageSeoIntelligence('client-1', 'https://example.com/tours')
    expect(result.geo_gaps.map(g => g.question)).toEqual(['real gap question'])
  })

  it('drops rows whose error columns were not selected (fail-closed)', async () => {
    const noColumns = { client_brand_rank: null, query: { question: 'q' } } as unknown as RunRow
    setupTables([noColumns])
    const result = await getPageSeoIntelligence('client-1', 'https://example.com/tours')
    expect(result.geo_gaps).toEqual([])
  })
})
