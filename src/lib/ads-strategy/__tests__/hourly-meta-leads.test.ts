import { describe, expect, it } from 'vitest'
import {
  buildHourlyLeadChart,
  nzHourFromIso,
  nzDateFromIso,
} from '../hourly-meta-leads'

describe('nzHourFromIso — DST edges', () => {
  it('NZDT summer: UTC afternoon maps to NZ next calendar morning hour', () => {
    // 2026-01-15 20:00 UTC = 2026-01-16 09:00 NZDT
    expect(nzDateFromIso('2026-01-15T20:00:00.000Z')).toBe('2026-01-16')
    expect(nzHourFromIso('2026-01-15T20:00:00.000Z')).toBe(9)
  })

  it('NZST winter: UTC maps with +12', () => {
    // 2026-07-15 14:00 UTC = 2026-07-16 02:00 NZST
    expect(nzDateFromIso('2026-07-14T14:00:00.000Z')).toBe('2026-07-15')
    expect(nzHourFromIso('2026-07-14T14:00:00.000Z')).toBe(2)
  })
})

describe('buildHourlyLeadChart', () => {
  const NOW = new Date('2026-10-20T03:30:00.000Z') // 16:30 NZDT → hour 16

  it('zero leads still returns numeric zeros when rows empty', () => {
    const r = buildHourlyLeadChart([], NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chart.totals.todaySoFar).toBe(0)
    expect(r.chart.bars.every(b => b.today === 0)).toBe(true)
  })

  it('counts match bucketed fixtures', () => {
    const rows = [
      { occurred_at: '2026-10-20T01:00:00.000Z' }, // ~14:00 NZ same day
      { occurred_at: '2026-10-20T01:05:00.000Z' },
      { occurred_at: '2026-10-19T01:00:00.000Z' }, // yesterday same clock
    ]
    const r = buildHourlyLeadChart(rows, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chart.totals.todaySoFar).toBeGreaterThanOrEqual(2)
    const h14 = r.chart.bars.find(b => b.hour === 14)
    expect(h14?.today).toBe(2)
    expect(r.chart.bars.filter(b => b.provisional).map(b => b.hour)).toEqual([15, 16])
  })

  it('invalid now → not ok (unreadable path)', () => {
    expect(buildHourlyLeadChart([], new Date(Number.NaN)).ok).toBe(false)
  })
})
