import { describe, it, expect } from 'vitest'
import { buildDaySeries } from '../day-series'
import type { ReportRow } from '../report-types'

const row = (key: string, spend: number, leads: number | null): ReportRow => ({
  key, spend, impressions: 1000, clicks: 20, leads,
  costPerLead: null, expectedLeads: null, flag: null, spendShare: 0,
})

describe('buildDaySeries', () => {
  it('sorts oldest first and labels MM-DD', () => {
    const out = buildDaySeries([row('2026-10-28', 100, 9), row('2026-10-26', 10, 0), row('2026-10-27', 60, 2)])
    expect(out.map(p => p.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28'])
    expect(out[0].label).toBe('10-26')
  })

  it('a day with no leads has no cost per lead (null, never 0); null leads count as 0', () => {
    const out = buildDaySeries([row('2026-10-26', 10, 0), row('2026-10-27', 50, null)])
    expect(out[0].cpl).toBeNull()
    expect(out[1].cpl).toBeNull()
    expect(out[1].leads).toBe(0)
  })

  it('daily cost per lead = spend / leads', () => {
    const out = buildDaySeries([row('2026-10-28', 101.8, 9)])
    expect(out[0].cpl).toBeCloseTo(11.311, 2)
  })

  it('7-day line sums spend and leads over the trailing 7 calendar days, not an average of daily values', () => {
    const rows = [row('2026-10-20', 100, 10), row('2026-10-26', 50, 1), row('2026-10-27', 50, 4)]
    const out = buildDaySeries(rows)
    // 10-27: window 10-21..10-27 -> the 10-20 row is outside; (50+50)/(1+4) = 20
    expect(out[2].cpl7).toBeCloseTo(20, 5)
    // 10-26: window 10-20..10-26 -> includes 10-20: (100+50)/(10+1)
    expect(out[1].cpl7).toBeCloseTo(150 / 11, 5)
  })

  it('a window with no leads at all gives no 7-day cost per lead', () => {
    const out = buildDaySeries([row('2026-10-26', 7, 0), row('2026-10-27', 9, 0)])
    expect(out[1].cpl7).toBeNull()
  })

  it('empty input gives an empty series', () => {
    expect(buildDaySeries([])).toEqual([])
  })
})
