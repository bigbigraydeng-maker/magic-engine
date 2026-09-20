/**
 * Regression tests for the weekly ranking_table (2026-09-20).
 *
 * This table is client-visible (it feeds the monthly brand ranking), and it
 * had no test coverage at all. The 2026-09-20 architecture review caught a
 * geo gate wrongly applied to bare brand names here, which un-merged four of
 * seven CTS brand keys. The rule is now: which entry IS the client is decided
 * per run, by the rank `resolveClientBrandRank` already resolved against that
 * run's answer text.
 */
import { describe, it, expect } from 'vitest'
import { buildRankingTable } from '../orchestrator'
import type { BrandMention } from '@/types/magic-engine'

const CTS = {
  brandName: 'CTS Tours',
  domain: 'ctstours.co.nz',
  aliases: ['cts', 'cts tours nz', 'china travel service', '中国旅行社'],
  geoAnchors: ['new zealand', 'nz', 'aotearoa', 'auckland'],
}

interface Row {
  ai_engine: string
  brands_mentioned: BrandMention[]
  client_brand_rank: number | null
}

function table(runs: Row[], identity = CTS) {
  const out = buildRankingTable(runs, identity) as {
    brands: Array<{ name: string; mentions: number; avg_rank: number | null }>
  }
  return new Map(out.brands.map(b => [b.name, b]))
}

describe('buildRankingTable', () => {
  it('merges every client name variant the run layer accepted into one row', () => {
    const runs: Row[] = [
      {
        ai_engine: 'openai',
        client_brand_rank: 1,
        brands_mentioned: [{ brand: 'CTS Tours', rank: 1, snippet: 'x' }],
      },
      {
        ai_engine: 'openai',
        client_brand_rank: 1,
        brands_mentioned: [{ brand: 'China Travel Service (NZ) Ltd', rank: 1, snippet: 'x' }],
      },
      {
        ai_engine: 'perplexity',
        client_brand_rank: 2,
        brands_mentioned: [
          { brand: 'Wendy Wu Tours', rank: 1, snippet: 'x' },
          { brand: '中国旅行社', rank: 2, snippet: 'x' },
        ],
      },
      {
        ai_engine: 'openai',
        client_brand_rank: 1,
        brands_mentioned: [{ brand: 'CTS', rank: 1, snippet: 'x' }],
      },
    ]
    const t = table(runs)
    // All four spellings collapse, even though only one of them spells "NZ".
    expect(t.get('CTS Tours')?.mentions).toBe(4)
    expect(t.has('China Travel Service (NZ) Ltd')).toBe(false)
    expect(t.has('中国旅行社')).toBe(false)
    expect(t.has('CTS')).toBe(false)
    expect(t.get('Wendy Wu Tours')?.mentions).toBe(1)
  })

  it('does not credit the client when that run rejected the mention', () => {
    // The Australian sibling: the run layer set client_brand_rank = null, so
    // the sibling keeps its own row instead of feeding the client's count.
    const runs: Row[] = [
      {
        ai_engine: 'openai',
        client_brand_rank: null,
        brands_mentioned: [
          { brand: 'China Travel Service (Australia) Pty Ltd', rank: 1, snippet: 'x' },
          { brand: 'Equity Travel', rank: 2, snippet: 'x' },
        ],
      },
    ]
    const t = table(runs)
    expect(t.has('CTS Tours')).toBe(false)
    expect(t.get('China Travel Service (Australia) Pty Ltd')?.mentions).toBe(1)
    expect(t.get('Equity Travel')?.mentions).toBe(1)
  })

  it('splits the same spelling across runs by what each run decided', () => {
    // Identical brand string, accepted in one answer and rejected in another.
    const runs: Row[] = [
      {
        ai_engine: 'openai',
        client_brand_rank: 1,
        brands_mentioned: [{ brand: 'China Travel Service', rank: 1, snippet: 'x' }],
      },
      {
        ai_engine: 'openai',
        client_brand_rank: null,
        brands_mentioned: [{ brand: 'China Travel Service', rank: 1, snippet: 'x' }],
      },
    ]
    const t = table(runs)
    expect(t.get('CTS Tours')?.mentions).toBe(1)
    expect(t.get('China Travel Service')?.mentions).toBe(1)
  })

  it('leaves an unrelated brand at the client rank alone', () => {
    // client_brand_rank points at rank 2, but rank 1 is someone else.
    const runs: Row[] = [
      {
        ai_engine: 'openai',
        client_brand_rank: 2,
        brands_mentioned: [
          { brand: 'Wendy Wu Tours', rank: 1, snippet: 'x' },
          { brand: 'CTS Tours NZ', rank: 2, snippet: 'x' },
        ],
      },
    ]
    const t = table(runs)
    expect(t.get('Wendy Wu Tours')?.mentions).toBe(1)
    expect(t.get('CTS Tours')?.mentions).toBe(1)
  })

  it('averages ranks and keeps per-engine detail after merging', () => {
    const runs: Row[] = [
      {
        ai_engine: 'openai',
        client_brand_rank: 1,
        brands_mentioned: [{ brand: 'CTS Tours', rank: 1, snippet: 'x' }],
      },
      {
        ai_engine: 'perplexity',
        client_brand_rank: 3,
        brands_mentioned: [{ brand: 'CTS', rank: 3, snippet: 'x' }],
      },
    ]
    const out = buildRankingTable(runs, CTS) as {
      brands: Array<{ name: string; avg_rank: number | null; by_engine: Record<string, number[]> }>
    }
    const client = out.brands.find(b => b.name === 'CTS Tours')
    expect(client?.avg_rank).toBe(2)
    expect(client?.by_engine).toEqual({ openai: [1], perplexity: [3] })
  })

  it('without an identity it just counts raw brand strings', () => {
    const runs: Row[] = [
      {
        ai_engine: 'openai',
        client_brand_rank: 1,
        brands_mentioned: [{ brand: 'CTS Tours', rank: 1, snippet: 'x' }],
      },
      {
        ai_engine: 'openai',
        client_brand_rank: 1,
        brands_mentioned: [{ brand: 'CTS', rank: 1, snippet: 'x' }],
      },
    ]
    const out = buildRankingTable(runs) as { brands: Array<{ name: string; mentions: number }> }
    expect(out.brands.map(b => b.name).sort()).toEqual(['CTS', 'CTS Tours'])
  })
})
