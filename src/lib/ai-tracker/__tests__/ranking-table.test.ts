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
import type { ClientBrandIdentity } from '../client-brand-match'
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

function table(runs: Row[], identity: ClientBrandIdentity = CTS) {
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

  // 魏征's adversarial review, 2026-09-20: client_brand_rank is the MINIMUM of
  // the client's entries, so keying the merge on it split 333 CTS runs / 686
  // entries out of the client's own row — into competitor rows the client
  // reads in its monthly report.
  it('merges EVERY client entry in an accepted run, not just the one at client_brand_rank', () => {
    const runs: Row[] = [
      {
        ai_engine: 'openai',
        client_brand_rank: 2,
        brands_mentioned: [
          { brand: 'Wendy Wu Tours', rank: 1, snippet: 'x' },
          { brand: 'CTS Tours', rank: 2, snippet: 'x' },
          { brand: 'China Travel Service (CTS) Auckland', rank: 4, snippet: 'x' },
          { brand: 'CTS', rank: 6, snippet: 'x' },
        ],
      },
    ]
    const t = table(runs)
    expect(t.get('CTS Tours')?.mentions).toBe(3)
    expect(t.has('China Travel Service (CTS) Auckland')).toBe(false)
    expect(t.has('CTS')).toBe(false)
    expect(t.get('Wendy Wu Tours')?.mentions).toBe(1)
  })

  it('a client with no anchors keeps the old table exactly, legacy rows included', () => {
    // A row that names the client while client_brand_rank is null is legacy
    // data. Re-adjudicating it is a separate job; an un-gated client must not
    // see its table change because of this feature.
    const ungated = { brandName: 'CTS Tours', domain: 'ctstours.co.nz', aliases: ['cts'] }
    const runs: Row[] = [
      {
        ai_engine: 'openai',
        client_brand_rank: null,
        brands_mentioned: [{ brand: 'CTS', rank: 1, snippet: 'x' }],
      },
      {
        ai_engine: 'openai',
        client_brand_rank: 1,
        brands_mentioned: [{ brand: 'CTS Tours', rank: 1, snippet: 'x' }],
      },
    ]
    expect(table(runs, ungated).get('CTS Tours')?.mentions).toBe(2)
    // The same rows WITH the gate on defer to each run's decision.
    expect(table(runs).get('CTS Tours')?.mentions).toBe(1)
    expect(table(runs).get('CTS')?.mentions).toBe(1)
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
