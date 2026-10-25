/**
 * Dated leads_count counts Meta leads inside the goal window.
 * The latest GA4 snapshot ignores the start date, so it must not fill a dated goal.
 * Goals with no dates keep the old order: website conversions first.
 */

import { describe, expect, it } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'

type Client = Parameters<typeof autoFetchMetricValue>[0]

interface Period {
  period_start: string
  period_end: string
}

interface AdRow {
  insight_date: string
  reach: number | null
  video_thruplays: number | null
  actions: Array<{ action_type: string; value: string }> | null
}

interface Ga4Snap {
  period_start: string
  period_end: string
  top_sources: Array<{ source: string; medium: string; sessions: number; conversions: number }>
}

interface RangeCall {
  gte: string
  lte: string
}

function lead(insight_date: string, n: number): AdRow {
  return {
    insight_date,
    reach: 10,
    video_thruplays: null,
    actions: [{ action_type: 'lead', value: String(n) }],
  }
}

function websiteConversions(period_start: string, period_end: string, conversions: number): Ga4Snap {
  return {
    period_start,
    period_end,
    top_sources: [{ source: 'google', medium: 'organic', sessions: 1, conversions }],
  }
}

function filteringDb(ga4: Ga4Snap | null, adRows: AdRow[]): { db: Client; queried: string[]; ads: RangeCall } {
  const queried: string[] = []
  const ads: RangeCall = { gte: '', lte: '' }

  function makeChain(table: string) {
    queried.push(table)
    const filters: Array<{ op: 'gte' | 'lte'; value: string }> = []

    const result = (): { data: unknown; error: null } => {
      if (table === 'ga4_traffic_snapshots') return { data: ga4, error: null }
      if (table === 'ad_daily_insights') {
        const gte = filters.find((f) => f.op === 'gte')?.value ?? ''
        const lte = filters.find((f) => f.op === 'lte')?.value ?? ''
        ads.gte = gte
        ads.lte = lte
        const rows = adRows.filter((row) => {
          if (gte && row.insight_date < gte) return false
          if (lte && row.insight_date > lte) return false
          return true
        })
        return { data: rows, error: null }
      }
      throw new Error(`unexpected table in test stub: ${table}`)
    }

    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: () => chain,
      gte: (_col: string, value: string) => {
        filters.push({ op: 'gte', value })
        return chain
      },
      lte: (_col: string, value: string) => {
        filters.push({ op: 'lte', value })
        return chain
      },
      limit: () => chain,
      maybeSingle: () => Promise.resolve(result()),
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve().then(result).then(onFulfilled, onRejected),
    }
    return chain
  }

  const db = { from: (table: string) => makeChain(table) } as unknown as Client
  return { db, queried, ads }
}

const NOW = new Date('2026-10-25T09:00:00Z')

describe('autoFetchMetricValue — leads_count 日期窗', () => {
  it('有起止日期时不计入开始日之前的数据，结束日收到今天', async () => {
    const goal: Period = { period_start: '2026-10-25', period_end: '2026-11-30' }
    const { db, queried, ads } = filteringDb(
      websiteConversions('2026-09-26', '2026-10-24', 33),
      [
        lead('2026-10-24', 10),
        lead('2026-10-25', 4),
        lead('2026-11-02', 7),
      ],
    )

    const result = await autoFetchMetricValue(db, 'client-1', 'leads_count', { goalPeriod: goal, now: NOW })

    expect(result).toMatchObject({
      ok: true,
      value: 4,
      source: 'auto.meta_leads',
      snapshot_date: '2026-10-25',
    })
    expect(ads).toEqual({ gte: '2026-10-25', lte: '2026-10-25' })
    expect(queried).not.toContain('ga4_traffic_snapshots')
  })

  it('有起止日期时优先数 Meta 线索，不用网站转化合计', async () => {
    const goal: Period = { period_start: '2026-10-01', period_end: '2026-10-20' }
    const { db, ads } = filteringDb(
      websiteConversions('2026-10-01', '2026-10-24', 33),
      [
        lead('2026-09-30', 10),
        lead('2026-10-10', 5),
        lead('2026-10-22', 9),
      ],
    )

    const result = await autoFetchMetricValue(db, 'client-1', 'leads_count', { goalPeriod: goal, now: NOW })

    expect(result).toMatchObject({ ok: true, value: 5, source: 'auto.meta_leads', snapshot_date: '2026-10-20' })
    expect(ads).toEqual({ gte: '2026-10-01', lte: '2026-10-20' })
  })

  it('没有起止日期时仍先用网站转化，不改去数广告线索', async () => {
    const ga4 = websiteConversions('2026-09-26', '2026-10-24', 33)
    const rows = [lead('2026-10-25', 4)]
    const omitted = filteringDb(ga4, rows)

    const withoutPeriod = await autoFetchMetricValue(omitted.db, 'client-1', 'leads_count', { now: NOW })

    expect(withoutPeriod).toMatchObject({ ok: true, value: 33, source: 'auto.ga4_conversions' })
    expect(omitted.queried).not.toContain('ad_daily_insights')

    const blank = filteringDb(ga4, rows)
    const blankPeriod = await autoFetchMetricValue(blank.db, 'client-1', 'leads_count', {
      goalPeriod: { period_start: '  ', period_end: '' },
      now: NOW,
    })

    expect(blankPeriod).toMatchObject({ ok: true, value: 33, source: 'auto.ga4_conversions' })
    expect(blank.queried).not.toContain('ad_daily_insights')
  })
})
