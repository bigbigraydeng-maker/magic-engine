import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (must be declared before importing the SUT) ──────────────────────

const mockCreate = vi.fn()

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_HAIKU: 'claude-haiku-4-5-20251001',
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
}))

import { standardiseBrand, standardiseBrandList } from '../brand-standardiser'

// ─── Stub Supabase client (matches the .from(...).select().eq().eq().maybeSingle() + .upsert() chains we actually call)
interface CacheRow { canonical_brand: string }

function makeSupabase(initialCache: Map<string, CacheRow> = new Map()) {
  const upserts: Array<{ industry_code: string; raw_lower: string; canonical_brand: string; source: string }> = []
  const lookups: Array<{ industry_code: string; raw_lower: string }> = []

  const client = {
    from: (table: string) => {
      if (table !== 'industry_brand_canonical') throw new Error(`unexpected table: ${table}`)

      const builder: {
        _eqs: Record<string, string>
        select: (..._args: unknown[]) => typeof builder
        eq: (col: string, val: string) => typeof builder
        maybeSingle: () => Promise<{ data: CacheRow | null; error: null }>
        upsert: (row: { industry_code: string; raw_lower: string; canonical_brand: string; source: string }) => Promise<{ error: null }>
      } = {
        _eqs: {},
        select() { return builder },
        eq(col, val) { builder._eqs[col] = val; return builder },
        async maybeSingle() {
          lookups.push({ industry_code: builder._eqs.industry_code, raw_lower: builder._eqs.raw_lower })
          const key = `${builder._eqs.industry_code}:${builder._eqs.raw_lower}`
          return { data: initialCache.get(key) ?? null, error: null }
        },
        async upsert(row) {
          upserts.push({
            industry_code: row.industry_code,
            raw_lower: row.raw_lower,
            canonical_brand: row.canonical_brand,
            source: row.source,
          })
          return { error: null }
        },
      }
      return builder
    },
  } as unknown as Parameters<typeof standardiseBrand>[1]['supabase']

  return { client, upserts, lookups }
}

function mockHaikuOk(canonical: string, tokens = { in: 50, out: 10 }) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify({ canonical }) }],
    usage: { input_tokens: tokens.in, output_tokens: tokens.out },
  })
}

function mockHaikuMarkdown(canonical: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: '```json\n' + JSON.stringify({ canonical }) + '\n```' }],
    usage: { input_tokens: 50, output_tokens: 10 },
  })
}

function mockHaikuBadJson() {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: 'Sorry, I cannot do that.' }],
    usage: { input_tokens: 50, output_tokens: 10 },
  })
}

function mockHaikuBadSchema() {
  // missing `canonical` key — Zod parse should throw
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify({ foo: 'bar' }) }],
    usage: { input_tokens: 50, output_tokens: 10 },
  })
}

beforeEach(() => { mockCreate.mockReset() })
afterEach(() => { mockCreate.mockReset() })

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('standardiseBrand — cache miss → LLM', () => {
  it('calls LLM, returns canonical, persists to cache', async () => {
    mockHaikuOk('CTS Tours')
    const { client, upserts } = makeSupabase()
    const result = await standardiseBrand('ctstours', { supabase: client, industryCode: 'inbound_tour' })
    expect(result.canonical).toBe('CTS Tours')
    expect(result.source).toBe('llm')
    expect(result.cost_usd).toBeGreaterThan(0)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      industry_code: 'inbound_tour',
      raw_lower: 'ctstours',
      canonical_brand: 'CTS Tours',
      source: 'llm',
    })
  })

  it('strips markdown fences from Haiku reply', async () => {
    mockHaikuMarkdown('Intrepid Travel')
    const { client } = makeSupabase()
    const result = await standardiseBrand('intrepidtravel', { supabase: client, industryCode: 'inbound_tour' })
    expect(result.canonical).toBe('Intrepid Travel')
  })
})

describe('standardiseBrand — cache hit', () => {
  it('returns cached value without calling LLM', async () => {
    const cache = new Map([['inbound_tour:ctstours', { canonical_brand: 'CTS Tours' }]])
    const { client } = makeSupabase(cache)
    const result = await standardiseBrand('ctstours', { supabase: client, industryCode: 'inbound_tour' })
    expect(result.canonical).toBe('CTS Tours')
    expect(result.source).toBe('cache')
    expect(result.cost_usd).toBe(0)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('cache is industry-scoped — same raw, different industry → LLM hit', async () => {
    const cache = new Map([['inbound_tour:cts', { canonical_brand: 'CTS Tours' }]])
    mockHaikuOk('CTS Eventim')  // hypothetical finance answer
    const { client } = makeSupabase(cache)
    const result = await standardiseBrand('cts', { supabase: client, industryCode: 'finance' })
    expect(result.canonical).toBe('CTS Eventim')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('industry scope is enforced — back-to-back calls under different industries each hit LLM', async () => {
    // Mutation guard: if cache key drops industry_code, the second call would
    // return the cached 'Brand A' instead of calling the LLM for 'Brand B'.
    const cache = new Map<string, CacheRow>()  // empty cache — both must miss
    mockHaikuOk('Brand A In Tourism')
    mockHaikuOk('Brand B In Finance')
    const { client, lookups, upserts } = makeSupabase(cache)

    const tourismResult = await standardiseBrand('acme', { supabase: client, industryCode: 'inbound_tour' })
    const financeResult = await standardiseBrand('acme', { supabase: client, industryCode: 'finance' })

    expect(tourismResult.canonical).toBe('Brand A In Tourism')
    expect(financeResult.canonical).toBe('Brand B In Finance')
    expect(mockCreate).toHaveBeenCalledTimes(2)  // ← drops to 1 if industry is removed from cache key
    expect(lookups[0]).toEqual({ industry_code: 'inbound_tour', raw_lower: 'acme' })
    expect(lookups[1]).toEqual({ industry_code: 'finance',      raw_lower: 'acme' })
    expect(upserts.map(u => u.industry_code)).toEqual(['inbound_tour', 'finance'])
  })
})

describe('standardiseBrand — retry + fallback', () => {
  it('retries once on bad JSON, succeeds on retry', async () => {
    mockHaikuBadJson()
    mockHaikuOk('CTS Tours')
    const { client, upserts } = makeSupabase()
    const result = await standardiseBrand('ctstours', { supabase: client, industryCode: 'inbound_tour' })
    expect(result.canonical).toBe('CTS Tours')
    expect(result.source).toBe('llm_retry')
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(upserts[0].source).toBe('llm_retry')
  })

  it('falls back to title-case after 2 failures', async () => {
    mockHaikuBadJson()
    mockHaikuBadSchema()
    const { client, upserts } = makeSupabase()
    const result = await standardiseBrand('cts_tours', { supabase: client, industryCode: 'inbound_tour' })
    expect(result.canonical).toBe('Cts Tours')
    expect(result.source).toBe('fallback')
    expect(result.cost_usd).toBe(0)
    // 魏征 Hotfix-4: fallback must NOT be cached, otherwise a Haiku outage
    // poisons the cache forever — next cycle would cache-hit the title-cased
    // value and never retry the LLM, even after Haiku recovers.
    expect(upserts).toHaveLength(0)
  })
})

describe('standardiseBrandList', () => {
  it('preserves order, dedupes canonical, sums cost', async () => {
    mockHaikuOk('CTS Tours')
    mockHaikuOk('Intrepid Travel')
    const { client } = makeSupabase()
    const result = await standardiseBrandList(
      ['ctstours', 'intrepidtravel', 'ctstours'],
      { supabase: client, industryCode: 'inbound_tour' },
    )
    expect(result.brands).toEqual(['CTS Tours', 'Intrepid Travel'])
    expect(result.total_cost_usd).toBeGreaterThan(0)
    expect(mockCreate).toHaveBeenCalledTimes(2)  // dup raw not re-called
  })

  it('drops UNKNOWN canonicals from output', async () => {
    mockHaikuOk('CTS Tours')
    mockHaikuOk('UNKNOWN')          // SEO article title
    mockHaikuOk('Intrepid Travel')
    const { client } = makeSupabase()
    const result = await standardiseBrandList(
      ['ctstours', 'best small group tours 2026', 'intrepidtravel'],
      { supabase: client, industryCode: 'inbound_tour' },
    )
    expect(result.brands).toEqual(['CTS Tours', 'Intrepid Travel'])
  })

  it('returns [] for empty input', async () => {
    const { client } = makeSupabase()
    const result = await standardiseBrandList([], { supabase: client, industryCode: 'inbound_tour' })
    expect(result.brands).toEqual([])
    expect(result.total_cost_usd).toBe(0)
  })
})
