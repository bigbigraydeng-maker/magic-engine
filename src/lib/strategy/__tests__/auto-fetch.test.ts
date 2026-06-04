/**
 * Tests for src/lib/strategy/auto-fetch.ts — A2.2 brand_search_volume
 * two-tier resolution (GSC primary → DataForSEO fallback).
 *
 * Covers:
 *   1. GSC snapshot with branded queries → returns sum of brand-tagged clicks
 *   2. GSC snapshot present but no branded queries → falls back to DataForSEO
 *   3. No GSC snapshot at all → falls back to DataForSEO
 *   4. No domain on client → skips GSC tier entirely, goes straight to DataForSEO
 *   5. Both GSC and DataForSEO fail → returns ok:false with diagnostic reason
 *   6. Brand-tagged queries with non-numeric clicks are ignored, not crashed on
 *
 * P0 (post live-data audit) — multi-word brand recognition:
 *   7. brand_aliases entries are matched as case-insensitive substrings
 *   8. CTS Tours real-data regression: "cts tours" / "china travel service" hit
 *   9. brand_aliases empty array is treated as null (defensive)
 *  10. isBrandQueryMatch unit coverage (pure function)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/dataforseo/labs', () => ({
  bulkKeywordVolume: vi.fn(),
}))
vi.mock('@/lib/seo-intelligence/keyword-snapshots', () => ({
  locationCodeForDb: (db: string | null) => (db === 'nz' ? 2554 : 2036),
}))

import { autoFetchMetricValue, isBrandQueryMatch } from '../auto-fetch'
import { bulkKeywordVolume } from '@/lib/dataforseo/labs'

const mockBulkKeywordVolume = vi.mocked(bulkKeywordVolume)

// Build a fake Supabase client whose .from(table) chains resolve to the
// pre-staged payload for that table. Keeps tests focused on the resolution
// logic, not the Supabase wire shape.
interface StagedResponse { data: unknown; error: unknown }
function makeFakeSupabase(byTable: Record<string, StagedResponse>) {
  return {
    from: (table: string) => {
      const staged = byTable[table] ?? { data: null, error: null }
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(() => Promise.resolve(staged)),
        single:      vi.fn(() => Promise.resolve(staged)),
      }
      return chain
    },
    } as any
}

describe('autoFetchMetricValue — brand_search_volume', () => {
  beforeEach(() => {
    mockBulkKeywordVolume.mockReset()
  })

  // ── Tier 1 success ────────────────────────────────────────────────────────

  it('returns sum of GSC brand-tagged clicks when snapshot has branded queries', async () => {
    const supabase = makeFakeSupabase({
      clients: {
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz', brand_aliases: null },
        error: null,
      },
      gsc_performance_snapshots: {
        data: {
          period_start: '2026-05-07',
          period_end:   '2026-06-04',
          top_queries: [
            { query: 'ctstours',           clicks: 120, impressions: 800 },
            { query: 'ctstours nz tours',  clicks:  45, impressions: 300 },
            { query: 'auckland day tours', clicks: 200, impressions: 5000 }, // non-brand
            { query: 'ctstours review',    clicks:  15, impressions: 100 },
          ],
        },
        error: null,
      },
    })

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(120 + 45 + 15) // 180 branded clicks
    expect(result.source).toContain('GSC')
    expect(result.label).toContain('180')
    expect(result.label).toContain('3 queries')
    expect(result.snapshot_date).toBe('2026-06-04')
    // DataForSEO must NOT have been hit when GSC succeeds
    expect(mockBulkKeywordVolume).not.toHaveBeenCalled()
  })

  // ── Tier 2 fallback: GSC empty / no branded queries ────────────────────────

  it('falls back to DataForSEO when GSC snapshot exists but no branded queries match', async () => {
    const supabase = makeFakeSupabase({
      clients: {
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz', brand_aliases: null },
        error: null,
      },
      gsc_performance_snapshots: {
        data: {
          period_start: '2026-05-07',
          period_end:   '2026-06-04',
          top_queries: [
            { query: 'day tours auckland', clicks: 200 },
            { query: 'luxury nz tours',    clicks: 100 },
          ],
        },
        error: null,
      },
    })
    mockBulkKeywordVolume.mockResolvedValue([
      { keyword: 'CTS Tours NZ', search_volume: 500, keyword_difficulty: null, cpc: null, competition: null, intent: 'informational' },
    ])

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(500)
    expect(result.source).toContain('DataForSEO')
    expect(result.source).toContain('GSC not yet connected')
    expect(mockBulkKeywordVolume).toHaveBeenCalledOnce()
  })

  it('falls back to DataForSEO when GSC has no snapshot row at all', async () => {
    const supabase = makeFakeSupabase({
      clients: {
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz', brand_aliases: null },
        error: null,
      },
      gsc_performance_snapshots: { data: null, error: null },
    })
    mockBulkKeywordVolume.mockResolvedValue([
      { keyword: 'CTS Tours NZ', search_volume: 320, keyword_difficulty: null, cpc: null, competition: null, intent: 'informational' },
    ])

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(320)
    expect(mockBulkKeywordVolume).toHaveBeenCalledOnce()
  })

  // ── Skip Tier 1 when no domain ────────────────────────────────────────────

  it('skips GSC tier when client has no domain, goes straight to DataForSEO', async () => {
    const supabase = makeFakeSupabase({
      clients: {
        data: { name: 'No Domain Co', semrush_db: 'au', domain: null, brand_aliases: null },
        error: null,
      },
      // gsc_performance_snapshots should not even be queried — but stage it
      // anyway to detect accidental queries via mockBulkKeywordVolume order.
      gsc_performance_snapshots: { data: null, error: null },
    })
    mockBulkKeywordVolume.mockResolvedValue([
      { keyword: 'No Domain Co', search_volume: 50, keyword_difficulty: null, cpc: null, competition: null, intent: 'informational' },
    ])

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(50)
    expect(result.source).toContain('DataForSEO')
  })

  // ── Both tiers fail ───────────────────────────────────────────────────────

  it('returns ok:false when both GSC and DataForSEO fail', async () => {
    const supabase = makeFakeSupabase({
      clients: {
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz', brand_aliases: null },
        error: null,
      },
      gsc_performance_snapshots: { data: null, error: null },
    })
    mockBulkKeywordVolume.mockResolvedValue([
      { keyword: 'CTS Tours NZ', search_volume: null, keyword_difficulty: null, cpc: null, competition: null, intent: 'informational' },
    ])

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('DataForSEO')
  })

  it('returns ok:false with helpful reason when client has no domain AND no name', async () => {
    const supabase = makeFakeSupabase({
      clients: { data: { name: null, semrush_db: 'nz', domain: null, brand_aliases: null }, error: null },
    })

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('no domain or name')
    expect(mockBulkKeywordVolume).not.toHaveBeenCalled()
  })

  // ── Defensive: malformed GSC rows ─────────────────────────────────────────

  it('ignores GSC top_queries entries with non-numeric clicks or missing query', async () => {
    const supabase = makeFakeSupabase({
      clients: {
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz', brand_aliases: null },
        error: null,
      },
      gsc_performance_snapshots: {
        data: {
          period_start: '2026-05-07',
          period_end:   '2026-06-04',
          top_queries: [
            { query: 'ctstours',     clicks: 50 },
            { query: 'ctstours nz',  clicks: 'oops' as unknown as number }, // bad type
            { query: undefined,      clicks: 999 },                          // missing query
            { query: 'ctstours faq', clicks: 25 },
          ],
        },
        error: null,
      },
    })

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(50 + 25) // only the two well-formed rows
    expect(result.label).toContain('2 queries')
  })

  // ── P0 fix: multi-word brand_aliases recognition ───────────────────────────

  it('CTS real-data regression — brand_aliases catches multi-word brand queries', async () => {
    // Replicates live CTS Tours NZ GSC snapshot (2026-06-04 audit). Without
    // brand_aliases, token-equality matching against domain root "ctstours"
    // would miss "cts tours" / "china travel service" → ~0 brand clicks.
    // With aliases + substring match, the real ~180 clicks surface.
    const supabase = makeFakeSupabase({
      clients: {
        data: {
          name: 'CTS Tours NZ',
          semrush_db: 'nz',
          domain: 'ctstours.co.nz',
          brand_aliases: ['cts tours', 'cts travel', 'china travel service', 'ctsnz'],
        },
        error: null,
      },
      gsc_performance_snapshots: {
        data: {
          period_start: '2026-05-07',
          period_end:   '2026-06-04',
          top_queries: [
            { query: 'cts tours',               clicks: 127, impressions: 219 },
            { query: 'china travel service nz', clicks:  21, impressions:  71 },
            { query: 'cts travel',              clicks:  13, impressions:  50 },
            { query: 'china tours from nz',     clicks:  12, impressions: 283 }, // non-brand
            { query: 'china travel service',    clicks:   9, impressions:  74 },
            { query: 'auckland day tours',      clicks: 200, impressions: 5000 }, // non-brand
          ],
        },
        error: null,
      },
    })

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(127 + 21 + 13 + 9) // 170 branded clicks
    expect(result.source).toContain('GSC')
    expect(result.label).toContain('4 queries')
    expect(mockBulkKeywordVolume).not.toHaveBeenCalled()
  })

  it('brand_aliases hits work even when domain root would not', async () => {
    // brand_aliases only flow: domain root "shopify" doesn't appear in
    // queries; alias "our cool brand" carries all matches.
    const supabase = makeFakeSupabase({
      clients: {
        data: {
          name: 'Our Cool Brand',
          semrush_db: 'au',
          domain: 'ocb.shopify.com', // root="ocb" matches nothing
          brand_aliases: ['our cool brand', 'ocb store'],
        },
        error: null,
      },
      gsc_performance_snapshots: {
        data: {
          period_start: '2026-05-07',
          period_end:   '2026-06-04',
          top_queries: [
            { query: 'our cool brand sale',     clicks: 40 },
            { query: 'ocb store opening hours', clicks: 25 },
            { query: 'cheap shoes near me',     clicks: 100 }, // non-brand
          ],
        },
        error: null,
      },
    })

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(40 + 25)
  })

  it('treats brand_aliases empty array same as null (still uses domain root)', async () => {
    const supabase = makeFakeSupabase({
      clients: {
        data: { name: 'Oztop', semrush_db: 'au', domain: 'oztop.com.au', brand_aliases: [] },
        error: null,
      },
      gsc_performance_snapshots: {
        data: {
          period_start: '2026-05-07',
          period_end:   '2026-06-04',
          top_queries: [
            { query: 'oztop building supplies', clicks: 35 }, // domain root "oztop" substring hit
            { query: 'engineered flooring',     clicks: 50 }, // non-brand
          ],
        },
        error: null,
      },
    })

    const result = await autoFetchMetricValue(supabase, 'client-1', 'brand_search_volume')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(35)
  })
})

// ── Pure unit tests for the brand-match predicate ───────────────────────────

describe('isBrandQueryMatch', () => {
  it('matches brand_aliases as case-insensitive substring', () => {
    expect(isBrandQueryMatch('CTS Tours New Zealand', null, ['cts tours'])).toBe(true)
    expect(isBrandQueryMatch('cts tours review',      null, ['CTS Tours'])).toBe(true)
  })

  it('matches domain root as substring when aliases are null', () => {
    expect(isBrandQueryMatch('oztop building supplies', 'oztop', null)).toBe(true)
    expect(isBrandQueryMatch('big panda flooring',      'oztop', null)).toBe(false)
  })

  it('returns false when query is empty / whitespace-only', () => {
    expect(isBrandQueryMatch('',     'oztop', null)).toBe(false)
    expect(isBrandQueryMatch('   ',  'oztop', null)).toBe(false)
  })

  it('returns false when neither aliases nor root match', () => {
    expect(isBrandQueryMatch('day tours auckland', 'ctstours', ['cts tours'])).toBe(false)
  })

  it('ignores alias entries that are non-strings or under 2 chars (defensive)', () => {
    expect(isBrandQueryMatch('foo bar', null, [123 as unknown as string, '', 'a', 'foo'])).toBe(true)
    expect(isBrandQueryMatch('xyz',     null, [null as unknown as string, '', 'a'])).toBe(false)
  })

  it('normalises whitespace — "CTS  Tours" (2 spaces) matches alias "cts tours"', () => {
    expect(isBrandQueryMatch('CTS  Tours  NZ', null, ['cts tours'])).toBe(true)
  })

  it('returns false when both brandRoot and aliases are null', () => {
    expect(isBrandQueryMatch('whatever', null, null)).toBe(false)
  })
})
