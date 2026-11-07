import { describe, it, expect } from 'vitest'
import {
  buildWeeklySummary,
  isBrandQuery,
  pctChange,
  renderWeeklyReportZh,
  splitBrand,
  type WeeklyReportInput,
} from '../build'

const base: WeeklyReportInput = {
  clientLabel: 'Example Client',
  window: { start: '2026-10-25', end: '2026-10-31' },
  previousWindow: { start: '2026-10-18', end: '2026-10-24' },
  gsc: {
    current: { clicks: 10, impressions: 100, position: 12 },
    previous: { clicks: 5, impressions: 80, position: 14 },
    queries: [
      { query: 'example brand', clicks: 6, impressions: 8, position: 1 },
      { query: 'the example brand', clicks: 1, impressions: 1, position: 1 },
      { query: 'new homes auckland', clicks: 3, impressions: 50, position: 40 },
    ],
    pages: [],
  },
  ga4: {
    periodStart: '2026-10-25',
    periodEnd: '2026-10-31',
    totalPageviews: 50,
    totalSessions: 30,
    totalUsers: 20,
    pages: [
      { page: '/riverside/', pageviews: 4 },
      { page: '/', pageviews: 19 },
    ],
  },
  leadsInWindow: 0,
  brandTerms: ['example brand'],
  siteUpdates: [],
  nextSteps: [],
}

describe('isBrandQuery', () => {
  it('matches singular/plural, spacing and extra words', () => {
    expect(isBrandQuery('example brand', ['example brand'])).toBe(true)
    expect(isBrandQuery('example brands', ['example brand'])).toBe(true)
    expect(isBrandQuery('the examplebrand ltd', ['example brand'])).toBe(true)
    expect(isBrandQuery('new homes auckland', ['example brand'])).toBe(false)
  })

  it('ignores brand terms too short to be distinctive', () => {
    expect(isBrandQuery('a b homes', ['ab'])).toBe(false)
  })
})

describe('splitBrand', () => {
  it('splits clicks and impressions by brand vs other', () => {
    expect(splitBrand(base.gsc!.queries, base.brandTerms)).toEqual({
      brandClicks: 7,
      brandImpressions: 9,
      otherClicks: 3,
      otherImpressions: 50,
    })
  })
})

describe('pctChange', () => {
  it('rounds, and returns null when the base is zero or unusable', () => {
    expect(pctChange(10, 5)).toBe(100)
    expect(pctChange(4, 5)).toBe(-20)
    expect(pctChange(3, 0)).toBeNull()
    expect(pctChange(Number.NaN, 5)).toBeNull()
  })
})

describe('buildWeeklySummary / render', () => {
  it('sorts top pages by pageviews and renders week-over-week change', () => {
    const s = buildWeeklySummary(base)
    expect(s.topPages[0]).toEqual({ page: '/', pageviews: 19 })
    const text = renderWeeklyReportZh(s)
    expect(text).toContain('出现 100 次（比上周多 25%）')
    expect(text).toContain('被点击 10 次（比上周多 100%）')
    expect(text).toContain('本周网站收到 0 条咨询')
  })

  it('never turns an unreadable source into a zero', () => {
    const s = buildWeeklySummary({ ...base, gsc: null, ga4: null, leadsInWindow: null })
    const text = renderWeeklyReportZh(s)
    expect(text).toContain('本周没有读到搜索后台数据')
    expect(text).toContain('本周没有读到流量统计数据')
    expect(text).toContain('本周没有读到咨询记录')
    expect(text).not.toContain('收到 0 条')
    expect(s.notes.length).toBe(3)
  })

  it('says previous week was zero instead of inventing a percentage', () => {
    const s = buildWeeklySummary({
      ...base,
      gsc: { ...base.gsc!, previous: { clicks: 0, impressions: 0, position: 0 } },
    })
    expect(renderWeeklyReportZh(s)).toContain('（上周为 0）')
  })

  it('does not invent brand numbers when no usable brand term is configured', () => {
    const text = renderWeeklyReportZh(buildWeeklySummary({ ...base, brandTerms: [] }))
    expect(text).not.toContain('通过品牌名搜索')
    const short = renderWeeklyReportZh(buildWeeklySummary({ ...base, brandTerms: ['home', '大瑞'] }))
    expect(short).not.toContain('通过品牌名搜索')
  })

  it('says unsupplied free-text sections are pending, never "none this week"', () => {
    const text = renderWeeklyReportZh(buildWeeklySummary(base))
    expect(text).not.toContain('本周没有新的更新')
    expect(text.match(/（待运营补充）/g)?.length).toBe(2)
  })

  it('shows the real GA4 interval, since it differs from the search window', () => {
    const text = renderWeeklyReportZh(
      buildWeeklySummary({ ...base, ga4: { ...base.ga4!, periodStart: '2026-10-28', periodEnd: '2026-11-04' } }),
    )
    expect(text).toContain('流量统计区间：2026-10-28 至 2026-11-04')
  })

  it('does not hardcode any client name', () => {
    const text = renderWeeklyReportZh(buildWeeklySummary({ ...base, clientLabel: 'Other Co' }))
    expect(text.startsWith('Other Co')).toBe(true)
  })
})
