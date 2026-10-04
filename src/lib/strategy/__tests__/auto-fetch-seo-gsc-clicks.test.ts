import { describe, expect, it } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'
import { PRIMARY_METRIC_CATALOG, getRecommendedMetrics } from '@/types/strategy'

interface Row { day: string; clicks: number | null }

/** Table-modelled fake of gsc_page_daily: honours order/gte/lte/range like PostgREST. */
function makeSupabase(rows: Row[], opts: { latestError?: string; readError?: string } = {}) {
  return {
    from(table: string) {
      if (table !== 'gsc_page_daily') throw new Error(`unexpected table ${table}`)
      let gte = ''
      let lte = '9999-12-31'
      let desc = false
      let range: [number, number] | null = null
      let limit: number | null = null
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        gte: (_c: string, v: string) => { gte = v; return chain },
        lte: (_c: string, v: string) => { lte = v; return chain },
        order: (_c: string, o: { ascending: boolean }) => { if (_c === 'day') desc = !o.ascending; return chain },
        limit: (n: number) => { limit = n; return chain },
        range: (a: number, b: number) => { range = [a, b]; return chain },
        maybeSingle: async () => {
          if (opts.latestError) return { data: null, error: { message: opts.latestError } }
          const sorted = [...rows].sort((a, b) => (desc ? b.day.localeCompare(a.day) : a.day.localeCompare(b.day)))
          return { data: sorted[0] ? { day: sorted[0].day } : null, error: null }
        },
        then: (resolve: (v: unknown) => void) => {
          if (opts.readError) return resolve({ data: null, error: { message: opts.readError } })
          let out = rows.filter(r => r.day >= gte && r.day <= lte).sort((a, b) => a.day.localeCompare(b.day))
          if (range) out = out.slice(range[0], range[1] + 1)
          if (limit !== null) out = out.slice(0, limit)
          return resolve({ data: out, error: null })
        },
      }
      return chain
    },
  } as any
}

function daysEndingAt(end: string, count: number, clicksPerDay: number, pagesPerDay = 1): Row[] {
  const rows: Row[] = []
  for (let i = 0; i < count; i += 1) {
    const d = new Date(`${end}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i)
    for (let p = 0; p < pagesPerDay; p += 1) rows.push({ day: d.toISOString().slice(0, 10), clicks: clicksPerDay })
  }
  return rows
}

const today = new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

describe('autoFetchMetricValue("seo_gsc_clicks_28d")', () => {
  it('sums all pages over the 28 days ending at the latest loaded day, across pagination', async () => {
    // 28 days × 100 pages × 1 click = 2,800 rows (3 PostgREST pages) → 2,800
    const sb = makeSupabase(daysEndingAt(daysAgo(4), 40, 1, 100))
    const r = await autoFetchMetricValue(sb, 'c1', 'seo_gsc_clicks_28d')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(2800)
      expect(r.snapshot_date).toBe(daysAgo(4))
      expect(r.source).toBe('auto.gsc_clicks_28d')
    }
  })

  it('does not count days older than the 28-day window', async () => {
    const sb = makeSupabase([...daysEndingAt(daysAgo(3), 28, 10), { day: daysAgo(40), clicks: 99999 }])
    const r = await autoFetchMetricValue(sb, 'c1', 'seo_gsc_clicks_28d')
    expect(r.ok && r.value).toBe(280)
  })

  it('no rows → noData unknown, never 0', async () => {
    const r = await autoFetchMetricValue(makeSupabase([]), 'c1', 'seo_gsc_clicks_28d')
    expect(r.ok).toBe(false)
    if (!r.ok) expect('unknown' in r && r.unknown).toBe(true)
    if (!r.ok) expect('noData' in r && r.noData).toBe(true)
  })

  it('stale latest day → fails closed as a fault (not noData)', async () => {
    const r = await autoFetchMetricValue(makeSupabase(daysEndingAt(daysAgo(20), 28, 10)), 'c1', 'seo_gsc_clicks_28d')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/days old/)
      expect('noData' in r).toBe(false)
    }
  })

  it('partial window (too few days present) → refuses a partial sum', async () => {
    const r = await autoFetchMetricValue(makeSupabase(daysEndingAt(daysAgo(3), 20, 10)), 'c1', 'seo_gsc_clicks_28d')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/only 20\/28 days/)
  })

  it('read error → unknown fault', async () => {
    const r = await autoFetchMetricValue(
      makeSupabase(daysEndingAt(daysAgo(3), 28, 10), { readError: 'boom' }),
      'c1',
      'seo_gsc_clicks_28d',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/boom/)
  })

  it('is registered once in the catalog and selectable for awareness/acquisition', () => {
    expect(PRIMARY_METRIC_CATALOG.filter(m => m.key === 'seo_gsc_clicks_28d')).toHaveLength(1)
    expect(getRecommendedMetrics('awareness', null).map(m => m.key)).toContain('seo_gsc_clicks_28d')
    expect(getRecommendedMetrics('acquisition', null).map(m => m.key)).toContain('seo_gsc_clicks_28d')
  })
})
