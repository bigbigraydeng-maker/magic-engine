/**
 * Unit tests for the pure parts of the weekly report (22.E.S18):
 * freshness stamping, SEO week computation, and the 断流 rendering rule.
 */

import { describe, it, expect } from 'vitest'
import { freshness, computeSeoWeek, renderWeeklyReport, type ClientWeekly } from '../build'

const NOW = new Date('2026-08-03T18:30:00Z')

describe('freshness', () => {
  it('recent data is fresh, old data is stale, missing is stale', () => {
    expect(freshness('2026-08-02T00:00:00Z', NOW)).toEqual({ latest: '2026-08-02', stale: false })
    expect(freshness('2026-07-20T00:00:00Z', NOW)).toEqual({ latest: '2026-07-20', stale: true })
    expect(freshness(null, NOW)).toEqual({ latest: null, stale: true })
  })
})

describe('computeSeoWeek', () => {
  const kw = (keyword: string, position: number | null) => ({ keyword, position, snapshot_date: 'x' })

  it('counts page-1/top-3 and picks top movers both ways', () => {
    const result = computeSeoWeek(
      [kw('a', 3), kw('b', 8), kw('c', 25), kw('d', 2)],
      [kw('a', 9), kw('b', 8), kw('c', 15), kw('d', 2)],
    )
    expect(result.page1_now).toBe(3)
    expect(result.page1_prior).toBe(3)
    expect(result.top3_now).toBe(2)
    expect(result.movers_up).toEqual([{ keyword: 'a', from: 9, to: 3 }])
    expect(result.movers_down).toEqual([{ keyword: 'c', from: 15, to: 25 }])
  })

  it('keywords missing from prior snapshot are not movers', () => {
    const result = computeSeoWeek([kw('new', 5)], [])
    expect(result.movers_up).toEqual([])
    expect(result.movers_down).toEqual([])
  })
})

describe('renderWeeklyReport — 断流 rule', () => {
  const base: ClientWeekly = {
    client_id: 'c1',
    name: 'CTS Tours NZ',
    seo: {
      page1_now: 9, page1_prior: 8, top3_now: 3,
      movers_up: [], movers_down: [],
      gsc_clicks_28d: 473, gsc_impressions_28d: 36445,
      findings_week: 2,
      freshness: { latest: '2026-08-02', stale: false },
    },
    auto_changes: { titles_applied_week: 8, freshness: { latest: '2026-08-01', stale: false } },
    blog: { generated_week: 1, published_week: 0, awaiting_review: 2 },
    social: {
      posts_7d: null, reactions_7d: null, days_since_last_post: null, reels_awaiting: 11,
      freshness: { latest: null, stale: true },
    },
    ads: {
      spend_7d: 120.5, leads_7d: 6, messages_7d: 9,
      freshness: { latest: '2026-08-02', stale: false },
    },
  }

  it('stale social section renders 断流 instead of numbers', () => {
    const { html } = renderWeeklyReport([base], '3 Aug 2026')
    expect(html).toContain('数据断流')
    expect(html).toContain('从未有数据')
    // reels awaiting still shows even when metrics are stale
    expect(html).toContain('11 条成片等你审')
  })

  it('fresh sections render numbers and review links', () => {
    const { html, subject } = renderWeeklyReport([base], '3 Aug 2026')
    expect(subject).toContain('每周盯梢报告')
    expect(html).toContain('473')
    expect(html).toContain('$120.5')
    expect(html).toContain('2 篇草稿等你点头')
    expect(html).toContain('自动改了 <b>8</b> 个页面标题')
  })

  it('断更 ≥7 天 renders the streak warning', () => {
    const c: ClientWeekly = {
      ...base,
      social: {
        posts_7d: 0, reactions_7d: 0, days_since_last_post: 12, reels_awaiting: 0,
        freshness: { latest: '2026-08-02', stale: false },
      },
    }
    const { html } = renderWeeklyReport([c], '3 Aug 2026')
    expect(html).toContain('已断更 12 天')
  })
})
