import { describe, expect, it } from 'vitest'
import { toClientHourlyLeadsView } from '../hourly-leads-client-view'

describe('toClientHourlyLeadsView', () => {
  it('drops internal jobName; keeps chart numbers', () => {
    const view = toClientHourlyLeadsView({
      success: true,
      unreadable: false,
      lastSyncAt: '2026-10-20T04:00:00.000Z',
      jobName: 'meta-leads-sync',
      chart: {
        nzDate: '2026-10-20',
        currentHour: 16,
        bars: [{ hour: 16, today: 2, avg7d: 1.2, provisional: true }],
        totals: { todaySoFar: 2, yesterdaySameTime: 1, lastWeekSameWeekdaySameTime: 0 },
      },
      forecast: { status: 'ok', rangeMin: 10, rangeMax: 18, historyDays: 15, disclaimer: '按过去 15 天的每小时规律推算，预算或广告一变就会不准' },
    })
    expect(view.viewer).toBe('client')
    expect(view.lastSyncLabel).toBeTruthy()
    expect(JSON.stringify(view)).not.toContain('jobName')
    expect(JSON.stringify(view)).not.toContain('meta-leads-sync')
    expect(view.forecast?.status).toBe('ok')
    if (view.forecast?.status === 'ok') {
      expect(view.forecast.rangeMin).toBeLessThanOrEqual(view.forecast.rangeMax)
    }
  })

  it('unreadable passes message through', () => {
    const view = toClientHourlyLeadsView({
      success: true,
      unreadable: true,
      message: '读不到',
      lastSyncAt: null,
    })
    expect(view.unreadable).toBe(true)
    expect(view.message).toBe('读不到')
    expect(view.chart).toBeUndefined()
  })
})
