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
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/dataforseo/labs', () => ({
  bulkKeywordVolume: vi.fn(),
}))
vi.mock('@/lib/seo-intelligence/keyword-snapshots', () => ({
  locationCodeForDb: (db: string | null) => (db === 'nz' ? 2554 : 2036),
}))

import { autoFetchMetricValue } from '../auto-fetch'
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
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz' },
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
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz' },
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
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz' },
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
        data: { name: 'No Domain Co', semrush_db: 'au', domain: null },
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
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz' },
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
      clients: { data: { name: null, semrush_db: 'nz', domain: null }, error: null },
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
        data: { name: 'CTS Tours NZ', semrush_db: 'nz', domain: 'ctstours.co.nz' },
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
})
