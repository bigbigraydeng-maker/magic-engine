import { describe, expect, it } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'
import { SOCIAL_METRIC_KEY } from '@/lib/flywheel/vocabulary'

interface MetricRow {
  metric_value: number
  measured_at: string
}

interface GoalPeriod {
  period_start: string
  period_end: string
}

function makeSupabase(
  metricRows: MetricRow[],
  opts: { goalPeriod?: GoalPeriod; queryError?: string } = {},
) {
  const goalPeriod = opts.goalPeriod ?? { period_start: '2026-10-01', period_end: '2026-10-31' }
  let gte = ''
  let lte = ''

  return {
    from(table: string) {
      if (table === 'goals') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          limit: () => chain,
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: [goalPeriod], error: null }),
        }
        return chain
      }
      if (table !== 'flywheel_metrics') throw new Error(`unexpected table ${table}`)

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: (_c: string, v: string) => {
          gte = v
          return chain
        },
        lte: (_c: string, v: string) => {
          lte = v
          return chain
        },
        order: () => chain,
        then: (resolve: (v: unknown) => void) => {
          if (opts.queryError) {
            return resolve({ data: null, error: { message: opts.queryError } })
          }
          const filtered = metricRows.filter(r => r.measured_at >= gte && r.measured_at <= lte)
          return resolve({ data: filtered, error: null })
        },
      }
      return chain
    },
  } as any
}

describe('autoFetchMetricValue("social_followers_growth")', () => {
  const goalPeriod = { period_start: '2026-10-01', period_end: '2026-10-31' }
  const now = new Date('2026-10-20T12:00:00.000Z')

  it('returns latest minus earliest when 2+ distinct days exist in the window', async () => {
    const sb = makeSupabase(
      [
        { metric_value: 1000, measured_at: '2026-10-05T08:00:00.000Z' },
        { metric_value: 1050, measured_at: '2026-10-05T20:00:00.000Z' },
        { metric_value: 1180, measured_at: '2026-10-15T06:00:00.000Z' },
      ],
      { goalPeriod },
    )
    const r = await autoFetchMetricValue(sb, 'client-1', 'social_followers_growth', { goalPeriod, now })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(180)
      expect(r.source).toBe('auto.tiktok_followers_growth')
      expect(r.snapshot_date).toBe('2026-10-15')
    }
  })

  it('uses SOCIAL_METRIC_KEY.TIKTOK_FOLLOWERS in the query filters', async () => {
    const eqCalls: Array<[string, string]> = []
    const sb = {
      from(table: string) {
        if (table === 'goals') {
          const chain: Record<string, unknown> = {
            select: () => chain,
            eq: () => chain,
            limit: () => chain,
            then: (resolve: (v: unknown) => void) => resolve({ data: [goalPeriod], error: null }),
          }
          return chain
        }
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (col: string, val: string) => {
            eqCalls.push([col, val])
            return chain
          },
          gte: () => chain,
          lte: () => chain,
          order: () => chain,
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        }
        return chain
      },
    } as any

    await autoFetchMetricValue(sb, 'client-1', 'social_followers_growth', { goalPeriod, now })
    expect(eqCalls).toContainEqual(['metric_key', SOCIAL_METRIC_KEY.TIKTOK_FOLLOWERS])
    expect(eqCalls).toContainEqual(['flywheel', 'social'])
    expect(eqCalls).toContainEqual(['source', 'tiktok_apify'])
  })

  it('fewer than 2 distinct days → unknown, never 0', async () => {
    const sb = makeSupabase([{ metric_value: 500, measured_at: '2026-10-10T00:00:00.000Z' }], { goalPeriod })
    const r = await autoFetchMetricValue(sb, 'client-1', 'social_followers_growth', { goalPeriod, now })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect('unknown' in r && r.unknown).toBe(true)
      expect('noData' in r).toBe(false)
      expect(r.reason).toMatch(/at least 2/)
    }
  })

  it('no rows → unknown with noData, never 0', async () => {
    const r = await autoFetchMetricValue(makeSupabase([], { goalPeriod }), 'client-1', 'social_followers_growth', {
      goalPeriod,
      now,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect('unknown' in r && r.unknown).toBe(true)
      expect('noData' in r && r.noData).toBe(true)
    }
  })
})
