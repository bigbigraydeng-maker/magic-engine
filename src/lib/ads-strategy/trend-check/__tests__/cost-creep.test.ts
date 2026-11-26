import { describe, expect, it } from 'vitest'
import { runDailyTrendCheck } from '../run'
import type { TrendDailyRow, TrendEntitySeries } from '../types'

function row(date: string, spend: number, results: number, impressions: number, clicks: number, cpm: number): TrendDailyRow {
  return { insight_date: date, spend, primary_results: results, impressions, clicks, cpm }
}

describe('cpl_vs_self_7d', () => {
  it('CPL 升高且 CPM、点击→留资稳定时命中 cost_creep', () => {
    const prior: TrendDailyRow[] = [
      row('2026-11-01', 40, 2, 1000, 50, 40),
      row('2026-11-02', 40, 2, 1000, 50, 40),
      row('2026-11-03', 40, 2, 1000, 50, 40),
      row('2026-11-04', 40, 2, 1000, 50, 40),
      row('2026-11-05', 40, 2, 1000, 50, 40),
      row('2026-11-06', 40, 2, 1000, 50, 40),
      row('2026-11-07', 40, 2, 1000, 50, 40),
    ]
    const recent: TrendDailyRow[] = [
      row('2026-11-08', 80, 1, 1000, 25, 40),
      row('2026-11-09', 82, 1, 1000, 25, 41),
      row('2026-11-10', 84, 1, 1000, 25, 40),
      row('2026-11-11', 86, 1, 1000, 25, 41),
      row('2026-11-12', 88, 1, 1000, 25, 40),
      row('2026-11-13', 90, 1, 1000, 25, 41),
      row('2026-11-14', 92, 1, 1000, 25, 40),
    ]
    const entity: TrendEntitySeries = {
      subject: { level: 'adset', id: 'fixture-adset-cost', name: 'Cost demo' },
      daily: [...prior, ...recent],
    }
    const result = runDailyTrendCheck({
      client_slug: 'fixture-cost',
      evaluation_date: '2026-11-14',
      target_cost_per_primary: 50,
      entities: [entity],
    })
    const creep = result.findings.find((f) => f.diagnosis_code === 'cost_creep')
    expect(creep?.rule_id).toBe('cpl_vs_self_7d')
    expect(creep?.evidence.cpl_rise_pct).toBeGreaterThanOrEqual(50)
  })
})
