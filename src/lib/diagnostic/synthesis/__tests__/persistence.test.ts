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
// In-memory fake Supabase that models the real diagnostic_narratives table
//
// The real table has NO plain unique constraint on (run_id, kind, dimension).
// Its only unique index is an EXPRESSION index:
//   UNIQUE (run_id, kind, COALESCE(dimension, ''))
// Postgres rejects ON CONFLICT (run_id,kind,dimension) against it (42P10),
// so `.upsert(...)` ALWAYS fails in production. The fake reproduces that.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface FakeOpts {
  deleteError?: { message: string } | null
  insertError?: { message: string } | null
  insertThrow?: Error
  selectData?: unknown[] | null
  selectError?: { message: string } | null
}

interface FakeSupabase {
  supabase: SupabaseClient
  rows: Row[]
}

const TABLE = 'diagnostic_narratives'

function uniqueKey(row: Row): string {
  const dim = row.dimension
  return `${String(row.run_id)}|${String(row.kind)}|${dim === null || dim === undefined ? '' : String(dim)}`
}

function makeFakeSupabase(opts: FakeOpts = {}): FakeSupabase {
  const rows: Row[] = []

  const from = vi.fn((table: string) => {
    if (table !== TABLE) throw new Error(`unexpected table: ${table}`)

    return {
      // delete() -> chainable filter builder; awaiting removes matching rows.
      delete: vi.fn(() => {
        const filters: Array<(r: Row) => boolean> = []
        const builder = {
          eq: vi.fn((col: string, val: unknown) => {
            filters.push(r => r[col] === val)
            return builder
          }),
          is: vi.fn((col: string, val: unknown) => {
            filters.push(r => r[col] === val)
            return builder
          }),
          then: (resolve: (v: { error: { message: string } | null }) => void) => {
            if (opts.deleteError) {
              resolve({ error: opts.deleteError })
              return Promise.resolve({ error: opts.deleteError })
            }
            for (let i = rows.length - 1; i >= 0; i--) {
              if (filters.every(f => f(rows[i]))) rows.splice(i, 1)
            }
            const result = { error: null }
            resolve(result)
            return Promise.resolve(result)
          },
        }
        return builder
      }),

      // insert() -> atomic; enforces the real unique key against existing rows
      // AND within the batch. On duplicate, inserts nothing.
      insert: vi.fn((newRows: Row[]) => {
        if (opts.insertThrow) throw opts.insertThrow
        if (opts.insertError) return Promise.resolve({ error: opts.insertError })

        const seen = new Set(rows.map(uniqueKey))
        for (const r of newRows) {
          const key = uniqueKey(r)
          if (seen.has(key)) {
            return Promise.resolve({
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "idx_diagnostic_narratives_unique"',
              },
            })
          }
          seen.add(key)
        }
        for (const r of newRows) rows.push({ ...r })
        return Promise.resolve({ error: null })
      }),

      // upsert() -> always fails in production (expression index can't be an
      // ON CONFLICT target). This is what makes the test fail if the
      // implementation regresses to upsert.
      upsert: vi.fn(() =>
        Promise.resolve({
          error: {
            code: '42P10',
            message:
              'there is no unique or exclusion constraint matching the ON CONFLICT specification',
          },
        }),
      ),

      // select() -> awaitable chain used by loadNarrativesForRun.
      select: vi.fn(() => {
        const selectResult = {
          data: opts.selectData ?? [],
          error: opts.selectError ?? null,
        }
        const chain = {
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: (resolve: (v: unknown) => void) => {
            resolve(selectResult)
            return Promise.resolve(selectResult)
          },
        }
        return chain
      }),
    }
  })

  const supabase = { from } as unknown as SupabaseClient
  return { supabase, rows }
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
    evidence_refs: [],
  }
}

function dimensionResult(dim: 'seo' | 'social' = 'seo'): DimensionNarrativeResult {
  return {
    dimension: dim,
    narrative_md: `## ${dim.toUpperCase()}\nCurrent state...`,
    cost_usd: 0.004,
    model_used: 'claude-sonnet-4-6',
    generated_at: GEN_AT,
    evidence_refs: [],
  }
}

function scoreResult(): ScoreExplainerResult {
  return {
    explanations: [
      { target: 'overall', score: 55, explanation_md: 'The 55/100 reflects...', evidence_refs: [] },
      { target: 'seo', score: 42, explanation_md: 'SEO 42/100 because thin content.', evidence_refs: [] },
      { target: 'social', score: 68, explanation_md: 'Social 68/100, low engagement drag.', evidence_refs: [] },
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
      { url: 'https://example.nz/report', title: 'NZ Tourism 2026' },
    ],
    web_search_calls: 3,
    cost_usd: 0.045,
    model_used: 'claude-sonnet-4-6',
    generated_at: GEN_AT,
    evidence_refs: ['https://example.nz/report'],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('saveCompetitorAnalysis', () => {
  it('writes two rows (market_structure + benchmarking_path) keyed to competitor dimension', async () => {
    const { supabase, rows } = makeFakeSupabase()
    const result = await saveCompetitorAnalysis(supabase, CTX, competitorResult())

    expect(result.ok).toBe(true)
    expect(result.rows_written).toBe(2)
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

  it('returns ok=false with error message when insert returns an error', async () => {
    const { supabase, rows } = makeFakeSupabase({ insertError: { message: 'rls denied' } })
    const result = await saveCompetitorAnalysis(supabase, CTX, competitorResult())
    expect(result.ok).toBe(false)
    expect(result.rows_written).toBe(0)
    expect(result.error).toBe('rls denied')
    expect(rows).toHaveLength(0)
  })

  it('swallows thrown exceptions and reports ok=false (never propagates)', async () => {
    const { supabase } = makeFakeSupabase({ insertThrow: new Error('network down') })
    const result = await saveCompetitorAnalysis(supabase, CTX, competitorResult())
    expect(result.ok).toBe(false)
    expect(result.error).toBe('network down')
  })
})

describe('saveDimensionNarrative / saveDimensionNarratives', () => {
  it('saves a single dimension narrative row', async () => {
    const { supabase, rows } = makeFakeSupabase()
    const result = await saveDimensionNarrative(supabase, CTX, dimensionResult('seo'))

    expect(result.ok).toBe(true)
    expect(result.rows_written).toBe(1)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.kind).toBe('dimension_narrative')
    expect(row.dimension).toBe('seo')
    expect(String(row.narrative_md)).toContain('## SEO')
    expect(row.cost_usd).toBe(0.004)
  })

  it('saves multiple dimension narratives in one call', async () => {
    const { supabase, rows } = makeFakeSupabase()
    const result = await saveDimensionNarratives(supabase, CTX, [
      dimensionResult('seo'),
      dimensionResult('social'),
    ])
    expect(result.rows_written).toBe(2)
    expect(rows.map(r => r.dimension)).toEqual(['seo', 'social'])
  })

  it('short-circuits on empty list (no supabase call)', async () => {
    const { supabase, rows } = makeFakeSupabase()
    const result = await saveDimensionNarratives(supabase, CTX, [])
    expect(result.ok).toBe(true)
    expect(result.rows_written).toBe(0)
    expect(rows).toHaveLength(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('saveScoreExplanations', () => {
  it('writes one row per explanation, attributes cost only to overall', async () => {
    const { supabase, rows } = makeFakeSupabase()
    const result = await saveScoreExplanations(supabase, CTX, scoreResult())

    expect(result.rows_written).toBe(3)
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
    const { supabase, rows } = makeFakeSupabase()
    const r = await saveScoreExplanations(supabase, CTX, {
      ...scoreResult(),
      explanations: [],
    })
    expect(r.ok).toBe(true)
    expect(r.rows_written).toBe(0)
    expect(rows).toHaveLength(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('saveMarketContext', () => {
  it('writes a single row with dimension=NULL and rich metadata', async () => {
    const { supabase, rows } = makeFakeSupabase()
    const result = await saveMarketContext(supabase, CTX, marketResult())

    expect(result.rows_written).toBe(1)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.kind).toBe('market_context')
    expect(row.dimension).toBeNull()
    expect(String(row.narrative_md)).toContain('Industry Overview')
    expect(String(row.narrative_md)).toContain('Benchmarks')
    expect(String(row.narrative_md)).toContain('Opportunities')

    const meta = row.metadata as Record<string, unknown>
    expect(meta.key_trends).toHaveLength(1)
    expect(meta.citations).toHaveLength(1)
    expect(meta.web_search_calls).toBe(3)
    expect(String(meta.industry_overview_md)).toContain('NZ boutique')
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
    const { supabase } = makeFakeSupabase({ selectData: fixture })
    const rows = await loadNarrativesForRun(supabase, 'run-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('dimension_narrative')
  })

  it('returns [] when supabase errors (warning only, no throw)', async () => {
    const { supabase } = makeFakeSupabase({
      selectData: null,
      selectError: { message: 'boom' },
    })
    const rows = await loadNarrativesForRun(supabase, 'run-1')
    expect(rows).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Replace-by-key semantics (delete-then-insert)
// ---------------------------------------------------------------------------

describe('replace-by-key semantics', () => {
  it('re-saving the same run replaces rows instead of failing', async () => {
    const { supabase, rows } = makeFakeSupabase()

    const first = await saveDimensionNarratives(supabase, CTX, [
      { ...dimensionResult('seo'), narrative_md: '## SEO\nv1' },
      { ...dimensionResult('social'), narrative_md: '## SOCIAL\nv1' },
    ])
    expect(first.ok).toBe(true)
    expect(rows).toHaveLength(2)

    const second = await saveDimensionNarratives(supabase, CTX, [
      { ...dimensionResult('seo'), narrative_md: '## SEO\nv2' },
      { ...dimensionResult('social'), narrative_md: '## SOCIAL\nv2' },
    ])
    expect(second.ok).toBe(true)
    expect(second.rows_written).toBe(2)
    expect(rows).toHaveLength(2)

    const seo = rows.find(r => r.dimension === 'seo')!
    expect(String(seo.narrative_md)).toContain('v2')
    expect(String(seo.narrative_md)).not.toContain('v1')
  })

  it('null dimension (market_context) can be saved twice for the same run', async () => {
    const { supabase, rows } = makeFakeSupabase()

    const first = await saveMarketContext(supabase, CTX, marketResult())
    expect(first.ok).toBe(true)

    const second = await saveMarketContext(supabase, CTX, marketResult())
    expect(second.ok).toBe(true)

    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('market_context')
    expect(rows[0].dimension).toBeNull()
  })

  it('rows of another run are untouched by a re-save', async () => {
    const { supabase, rows } = makeFakeSupabase()

    // Pre-populate a row for run-2 with the same kind/dimension.
    const other = await saveDimensionNarrative(
      supabase,
      { runId: 'run-2', clientId: 'client-1' },
      { ...dimensionResult('seo'), narrative_md: '## SEO\nrun-2 version' },
    )
    expect(other.ok).toBe(true)
    expect(rows).toHaveLength(1)

    // Re-save run-1.
    const res = await saveDimensionNarrative(supabase, CTX, dimensionResult('seo'))
    expect(res.ok).toBe(true)

    expect(rows).toHaveLength(2)
    const run2 = rows.find(r => r.run_id === 'run-2')!
    expect(run2).toBeDefined()
    expect(String(run2.narrative_md)).toContain('run-2 version')
  })

  it('returns ok:false with the delete error and writes nothing when delete fails', async () => {
    const { supabase, rows } = makeFakeSupabase({
      deleteError: { message: 'delete denied' },
    })
    const result = await saveDimensionNarrative(supabase, CTX, dimensionResult('seo'))
    expect(result.ok).toBe(false)
    expect(result.rows_written).toBe(0)
    expect(result.error).toBe('delete denied')
    expect(rows).toHaveLength(0)
  })

  it('returns ok:false with the insert error message when insert fails', async () => {
    const { supabase, rows } = makeFakeSupabase({
      insertError: { message: 'rls denied' },
    })
    const result = await saveDimensionNarrative(supabase, CTX, dimensionResult('seo'))
    expect(result.ok).toBe(false)
    expect(result.rows_written).toBe(0)
    expect(result.error).toBe('rls denied')
    expect(rows).toHaveLength(0)
  })

  it('swallows a thrown insert exception and reports ok:false', async () => {
    const { supabase } = makeFakeSupabase({ insertThrow: new Error('network down') })
    const result = await saveDimensionNarrative(supabase, CTX, dimensionResult('seo'))
    expect(result.ok).toBe(false)
    expect(result.rows_written).toBe(0)
    expect(result.error).toBe('network down')
  })
})
