import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  saveCompetitorAnalysis,
  saveDimensionNarrative,
  saveDimensionNarratives,
  saveScoreExplanations,
  saveMarketContext,
  loadNarrativesForRun,
} from '../persistence'
import type { CompetitorAnalystResult } from '../competitor-analyst'
import type { DimensionNarrativeResult } from '../dimension-narrator'
import type { ScoreExplainerResult } from '../score-explainer'
import type { MarketContextResult } from '../market-context'

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

interface UpsertCall {
  table: string
  rows: Array<Record<string, unknown>>
  options?: { onConflict?: string }
}

interface SelectChain {
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  then?: (resolve: (v: unknown) => void) => void
}

function makeMockSupabase(opts: {
  upsertError?: { message: string } | null
  upsertThrow?: Error
  selectData?: unknown[] | null
  selectError?: { message: string } | null
} = {}) {
  const upsertCalls: UpsertCall[] = []
  const upsertResult = { error: opts.upsertError ?? null }
  const selectResult = {
    data: opts.selectData ?? [],
    error: opts.selectError ?? null,
  }

  const builder = (table: string) => {
    return {
      upsert: vi.fn((rows: Array<Record<string, unknown>>, options?: { onConflict?: string }) => {
        upsertCalls.push({ table, rows, options })
        if (opts.upsertThrow) throw opts.upsertThrow
        return Promise.resolve(upsertResult)
      }),
      select: vi.fn(() => {
        const chain: SelectChain & { eq: any; order: any } = {
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
        }
        // Make the chain awaitable on the final call
        ;(chain as unknown as Promise<unknown>).then = (resolve: (v: unknown) => void) =>
          resolve(selectResult)
        // Make .order() chainable and ultimately resolve
        chain.order.mockImplementation(() => chain)
        chain.eq.mockImplementation(() => chain)
        return chain
      }),
    }
  }

  const supabase = {
    from: vi.fn((table: string) => builder(table)),
  } as unknown as SupabaseClient

  return { supabase, upsertCalls }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CTX = { runId: 'run-1', clientId: 'client-1' }
const GEN_AT = '2026-05-18T12:00:00.000Z'

function competitorResult(): CompetitorAnalystResult {
  return {
    market_structure_md: '## Market Structure\nLeader dominates...',
    benchmarking_path_md: '## Benchmarking Path\n1. Match X',
    cost_usd: 0.0123,
    model_used: 'claude-sonnet-4-6',
    generated_at: GEN_AT,
  }
}

function dimensionResult(dim: 'seo' | 'social' = 'seo'): DimensionNarrativeResult {
  return {
    dimension: dim,
    narrative_md: `## ${dim.toUpperCase()}\nCurrent state...`,
    cost_usd: 0.004,
    model_used: 'claude-sonnet-4-6',
    generated_at: GEN_AT,
  }
}

function scoreResult(): ScoreExplainerResult {
  return {
    explanations: [
      { target: 'overall', score: 55, explanation_md: 'The 55/100 reflects...' },
      { target: 'seo', score: 42, explanation_md: 'SEO 42/100 because thin content.' },
      { target: 'social', score: 68, explanation_md: 'Social 68/100, low engagement drag.' },
    ],
    cost_usd: 0.0089,
    model_used: 'claude-sonnet-4-6',
    generated_at: GEN_AT,
  }
}

function marketResult(): MarketContextResult {
  return {
    industry_overview_md: '## Industry Overview\nNZ boutique tour market...',
    key_trends: [
      { title: 'Personalisation', detail: 'Buyers expect 1:1 itineraries.' },
    ],
    category_benchmarks_md: '## Benchmarks\nTypical NPS ~50.',
    opportunities_md: '## Opportunities\nLean into Maori-led tours.',
    citations: [
      { url: 'https://example.nz/report', title: 'NZ Tourism 2026', cited_text: 'snippet' },
    ],
    web_search_calls: 3,
    cost_usd: 0.045,
    model_used: 'claude-sonnet-4-6',
    generated_at: GEN_AT,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('saveCompetitorAnalysis', () => {
  it('upserts two rows (market_structure + benchmarking_path) keyed to competitor dimension', async () => {
    const { supabase, upsertCalls } = makeMockSupabase()
    const result = await saveCompetitorAnalysis(supabase, CTX, competitorResult())

    expect(result.ok).toBe(true)
    expect(result.rows_written).toBe(2)
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].table).toBe('diagnostic_narratives')
    expect(upsertCalls[0].options?.onConflict).toBe('run_id,kind,dimension')

    const rows = upsertCalls[0].rows
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.kind)).toEqual([
      'competitor_market_structure',
      'competitor_benchmarking_path',
    ])
    for (const row of rows) {
      expect(row.run_id).toBe('run-1')
      expect(row.client_id).toBe('client-1')
      expect(row.dimension).toBe('competitor')
      expect(row.model).toBe('claude-sonnet-4-6')
      expect(row.generated_at).toBe(GEN_AT)
    }
  })

  it('returns ok=false with error message when supabase upsert returns an error', async () => {
    const { supabase } = makeMockSupabase({ upsertError: { message: 'rls denied' } })
    const result = await saveCompetitorAnalysis(supabase, CTX, competitorResult())
    expect(result.ok).toBe(false)
    expect(result.rows_written).toBe(0)
    expect(result.error).toBe('rls denied')
  })

  it('swallows thrown exceptions and reports ok=false (never propagates)', async () => {
    const { supabase } = makeMockSupabase({ upsertThrow: new Error('network down') })
    const result = await saveCompetitorAnalysis(supabase, CTX, competitorResult())
    expect(result.ok).toBe(false)
    expect(result.error).toBe('network down')
  })
})

describe('saveDimensionNarrative / saveDimensionNarratives', () => {
  it('saves a single dimension narrative row', async () => {
    const { supabase, upsertCalls } = makeMockSupabase()
    const result = await saveDimensionNarrative(supabase, CTX, dimensionResult('seo'))

    expect(result.ok).toBe(true)
    expect(result.rows_written).toBe(1)
    const row = upsertCalls[0].rows[0]
    expect(row.kind).toBe('dimension_narrative')
    expect(row.dimension).toBe('seo')
    expect(row.narrative_md).toContain('## SEO')
    expect(row.cost_usd).toBe(0.004)
  })

  it('saves multiple dimension narratives in one upsert', async () => {
    const { supabase, upsertCalls } = makeMockSupabase()
    const result = await saveDimensionNarratives(supabase, CTX, [
      dimensionResult('seo'),
      dimensionResult('social'),
    ])
    expect(result.rows_written).toBe(2)
    expect(upsertCalls[0].rows.map(r => r.dimension)).toEqual(['seo', 'social'])
  })

  it('short-circuits on empty list (no supabase call)', async () => {
    const { supabase, upsertCalls } = makeMockSupabase()
    const result = await saveDimensionNarratives(supabase, CTX, [])
    expect(result.ok).toBe(true)
    expect(result.rows_written).toBe(0)
    expect(upsertCalls).toHaveLength(0)
  })
})

describe('saveScoreExplanations', () => {
  it('writes one row per explanation, attributes cost only to overall', async () => {
    const { supabase, upsertCalls } = makeMockSupabase()
    const result = await saveScoreExplanations(supabase, CTX, scoreResult())

    expect(result.rows_written).toBe(3)
    const rows = upsertCalls[0].rows
    expect(rows.map(r => r.dimension)).toEqual(['overall', 'seo', 'social'])
    expect(rows.every(r => r.kind === 'score_explanation')).toBe(true)

    const overall = rows.find(r => r.dimension === 'overall')!
    const seo = rows.find(r => r.dimension === 'seo')!
    expect(overall.cost_usd).toBe(0.0089)
    expect(seo.cost_usd).toBe(0)

    // metadata.score is preserved
    expect((overall.metadata as { score: number }).score).toBe(55)
    expect((seo.metadata as { score: number }).score).toBe(42)
  })

  it('short-circuits when explanations are empty', async () => {
    const { supabase, upsertCalls } = makeMockSupabase()
    const r = await saveScoreExplanations(supabase, CTX, {
      ...scoreResult(),
      explanations: [],
    })
    expect(r.ok).toBe(true)
    expect(r.rows_written).toBe(0)
    expect(upsertCalls).toHaveLength(0)
  })
})

describe('saveMarketContext', () => {
  it('writes a single row with dimension=NULL and rich metadata', async () => {
    const { supabase, upsertCalls } = makeMockSupabase()
    const result = await saveMarketContext(supabase, CTX, marketResult())

    expect(result.rows_written).toBe(1)
    const row = upsertCalls[0].rows[0]
    expect(row.kind).toBe('market_context')
    expect(row.dimension).toBeNull()
    expect(row.narrative_md).toContain('Industry Overview')
    expect(row.narrative_md).toContain('Benchmarks')
    expect(row.narrative_md).toContain('Opportunities')

    const meta = row.metadata as Record<string, unknown>
    expect(meta.key_trends).toHaveLength(1)
    expect(meta.citations).toHaveLength(1)
    expect(meta.web_search_calls).toBe(3)
    expect(meta.industry_overview_md).toContain('NZ boutique')
  })
})

describe('loadNarrativesForRun', () => {
  it('returns rows from supabase ordered by kind/dimension', async () => {
    const fixture = [
      {
        id: 'n1',
        run_id: 'run-1',
        client_id: 'client-1',
        kind: 'dimension_narrative',
        dimension: 'seo',
        narrative_md: '## SEO',
        metadata: null,
        model: 'claude-sonnet-4-6',
        cost_usd: 0.003,
        generated_at: GEN_AT,
        created_at: GEN_AT,
      },
    ]
    const { supabase } = makeMockSupabase({ selectData: fixture })
    const rows = await loadNarrativesForRun(supabase, 'run-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('dimension_narrative')
  })

  it('returns [] when supabase errors (warning only, no throw)', async () => {
    const { supabase } = makeMockSupabase({
      selectData: null,
      selectError: { message: 'boom' },
    })
    const rows = await loadNarrativesForRun(supabase, 'run-1')
    expect(rows).toEqual([])
  })
})
