// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('./fake-db')).fakeDb.client }))

import { supabaseAdmin } from '@/lib/supabase'
import { fakeDb } from './fake-db'
import { getBrandSplit } from '../brand-split-query'

const A = 'c0000000-0000-0000-0000-000000000000'
const B = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const WINDOW = { startDay: '2026-09-01', endDay: '2026-09-30' }

function qp(client: string, day: string, query: string, page: string, clicks: number, impressions: number, position = 5) {
  return { client_id: client, day, query, page_url: page, page_key: page, clicks, impressions, position }
}

function seed(seoConfig: unknown, siteUrl = 'https://ctstours.example.com/', aliases: string[] = []) {
  fakeDb.tables.clients = [{ id: A, seo_config: seoConfig, brand_aliases: aliases }, { id: B, seo_config: {}, brand_aliases: [] }]
  fakeDb.tables.client_connectors = [
    { client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: siteUrl } },
  ]
  fakeDb.tables.gsc_query_page_daily = [
    qp(A, '2026-09-02', 'cts tours', 'https://x/a', 10, 100, 2),
    qp(A, '2026-09-02', 'ctstours nz', 'https://x/a', 4, 40, 3),
    qp(A, '2026-09-03', 'china travel service', 'https://x/b', 2, 50, 8),
    qp(A, '2026-09-03', 'great wall tour', 'https://x/c', 1, 200, 12),
    qp(A, '2026-09-03', 'great wall tour', 'https://x/d', 1, 100, 6),
    qp(A, '2026-08-31', 'cts tours', 'https://x/a', 99, 999), // outside the window
    qp(B, '2026-09-02', 'cts tours', 'https://x/a', 77, 777), // another client
  ]
  fakeDb.tables.gsc_page_daily = [
    { client_id: A, day: '2026-09-02', page_url: 'https://x/a', page_key: 'x/a', clicks: 16, impressions: 160, ctr: 0.1, position: 2 },
    { client_id: A, day: '2026-09-03', page_url: 'https://x/b', page_key: 'x/b', clicks: 3, impressions: 60, ctr: 0.05, position: 8 },
    { client_id: A, day: '2026-09-03', page_url: 'https://x/c', page_key: 'x/c', clicks: 1, impressions: 200, ctr: 0, position: 12 },
    { client_id: A, day: '2026-09-03', page_url: 'https://x/d', page_key: 'x/d', clicks: 1, impressions: 100, ctr: 0, position: 6 },
  ]
}

beforeEach(() => {
  fakeDb.reset()
})

describe('getBrandSplit', () => {
  it('🔴 a client with no brand terms gets "not configured" — never a guessed split', async () => {
    seed({})
    const report = await getBrandSplit(supabaseAdmin, A, WINDOW)
    expect(report.status).toBe('brand_terms_not_configured')
    const other = await getBrandSplit(supabaseAdmin, B, WINDOW)
    expect(other.status).toBe('brand_terms_not_configured')
  })

  it('splits only this client and this window, into brand / ambiguous / non-brand, with the gap to page level reported', async () => {
    seed({ brand_terms: ['cts'], brand_ambiguous_terms: ['china travel service'] })
    const report = await getBrandSplit(supabaseAdmin, A, WINDOW)
    expect(report.status).toBe('ok')
    if (report.status !== 'ok') return
    // "cts tours" and "ctstours nz" (domain stem "ctstours" extends "cts") are brand; the other client's row and the
    // out-of-window row are not counted.
    expect(report.buckets.brand.clicks).toBe(14)
    expect(report.buckets.brand.impressions).toBe(140)
    expect(report.buckets.brand.distinct_queries).toBe(2)
    expect(report.buckets.ambiguous.clicks).toBe(2)
    expect(report.buckets.non_brand.clicks).toBe(2)
    expect(report.buckets.non_brand.distinct_queries).toBe(1)
    // The same query on two pages is one query, impression-weighted position (200*12 + 100*6) / 300 = 10.
    expect(report.buckets.non_brand.position).toBeCloseTo(10, 6)
    expect(report.query_level).toEqual({ clicks: 18, impressions: 490, rows: 5 })
    expect(report.page_level).toEqual({ clicks: 21, impressions: 520 })
    expect(report.unattributed).toEqual({ clicks: 3, impressions: 30 })
  })

  it('a client with no brand_terms but existing brand_aliases is split with the aliases; explicit brand_terms win', async () => {
    seed({}, 'https://ctstours.example.com/', ['cts'])
    const viaAliases = await getBrandSplit(supabaseAdmin, A, WINDOW)
    expect(viaAliases.status).toBe('ok')
    seed({ brand_terms: ['great wall'] }, 'https://ctstours.example.com/', ['cts'])
    const explicit = await getBrandSplit(supabaseAdmin, A, WINDOW)
    expect(explicit.status === 'ok' && explicit.buckets.brand.clicks).toBe(2)
  })

  it('reports coverage and warns when the two tables cover different days or the gap is negative', async () => {
    seed({ brand_terms: ['cts'] })
    const ok = await getBrandSplit(supabaseAdmin, A, WINDOW)
    expect(ok.status === 'ok' && ok.coverage).toEqual({ days_with_query_rows: 2, days_with_page_rows: 2 })
    expect(ok.status === 'ok' && ok.warnings).toEqual([])
    // a query day with no page rows at all: coverage differs and the gap goes negative
    fakeDb.tables.gsc_query_page_daily.push(qp(A, '2026-09-04', 'cts tours', 'https://x/a', 50, 500))
    const bad = await getBrandSplit(supabaseAdmin, A, WINDOW)
    expect(bad.status).toBe('ok')
    if (bad.status !== 'ok') return
    expect(bad.coverage).toEqual({ days_with_query_rows: 3, days_with_page_rows: 2 })
    expect(bad.unattributed.clicks).toBeLessThan(0)
    expect(bad.warnings).toHaveLength(2)
  })

  it('🔴 the page-level total is also limited to this client and this window', async () => {
    seed({ brand_terms: ['cts'] })
    fakeDb.tables.gsc_page_daily.push(
      { client_id: B, day: '2026-09-02', page_url: 'https://x/z', page_key: 'x/z', clicks: 1000, impressions: 1000, ctr: 1, position: 1 },
      { client_id: A, day: '2026-10-15', page_url: 'https://x/z', page_key: 'x/z', clicks: 2000, impressions: 2000, ctr: 1, position: 1 },
      { client_id: A, day: '2026-08-15', page_url: 'https://x/z', page_key: 'x/z', clicks: 4000, impressions: 4000, ctr: 1, position: 1 },
    )
    const report = await getBrandSplit(supabaseAdmin, A, WINDOW)
    expect(report.status === 'ok' && report.page_level).toEqual({ clicks: 21, impressions: 520 })
  })

  it('a database error is thrown, not turned into an empty split', async () => {
    seed({ brand_terms: ['cts'] })
    fakeDb.fail({ table: 'gsc_query_page_daily', op: 'select', message: 'boom' })
    await expect(getBrandSplit(supabaseAdmin, A, WINDOW)).rejects.toThrow('boom')
  })
})
