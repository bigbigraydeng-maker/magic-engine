import { describe, expect, it } from 'vitest'
import { diagnoseCtrGap, findSiblings, type PageQueryRow } from '../ctr-diagnosis'
import { buildCtrGapItem, type ItemContext } from '../items'
import type { LiveSnippet } from '../live-snippet'
const liveOf = (title: string | null, description: string | null = 'd'): LiveSnippet => ({ title, description, canonical: null, noindex: false, status: 200 })
import type { CtrGapCandidate, PageAggRow, SitePageRow } from '../candidates'

const page = (url: string, title: string): SitePageRow => ({ url, path: new URL(url).pathname, title, h1: null, word_count: 900 })
const agg = (url: string, impressions: number, clicks: number): PageAggRow => ({ url, impressions, clicks, position: 7 })

// 20 generic site pages so "distinctive word" frequency is meaningful
const filler = Array.from({ length: 20 }, (_, i) => page(`https://x.com/blog/filler-${i}`, `China travel guide filler ${i}`))
const SELF = page('https://x.com/liziba-station-chongqing', 'Liziba Station, Chongqing: A Complete Visitor Guide')
const SIB1 = page('https://x.com/blog/liziba-station-chongqing-guide', 'Liziba Station Chongqing: Complete Visitor Guide')
const UNRELATED = page('https://x.com/blog/how-many-days-in-chongqing', 'How Many Days in Chongqing? 3, 5 or 7 Days')
const sitePages = [SELF, SIB1, UNRELATED, ...filler]
const pageAgg = [agg(SELF.url, 2386, 4), agg(SIB1.url, 5536, 18), agg(UNRELATED.url, 3153, 41)]
const base = { page: { url: SELF.url, impressions: 2386 }, title: SELF.title, sitePages, pageAgg, brandRoot: 'acme', brandAliases: ['acme'] }
const q = (query: string, impressions: number, clicks: number, position: number): PageQueryRow => ({ query, impressions, clicks, ctr: clicks / impressions, position })

describe('findSiblings', () => {
  it('finds the near-duplicate page via DISTINCTIVE shared words; a page sharing only a common word is not a sibling', () => {
    const sibs = findSiblings(base)
    expect(sibs.map(s => s.url)).toEqual([SIB1.url])
    expect(sibs[0].sharedTerms).toEqual(expect.arrayContaining(['liziba']))
  })
  it('two COMMON words (every filler page has them) do not make a sibling — only distinctive words do', () => {
    const self = page('https://x.com/alpha-travel-guide', 'Alpha travel guide')
    const common = page('https://x.com/beta-travel-guide', 'Beta travel guide')
    const pages = [self, common, ...filler.map(f => ({ ...f, title: 'China travel guide filler' }))]
    const sibs = findSiblings({ page: { url: self.url, impressions: 900 }, title: self.title, sitePages: pages, pageAgg: [agg(self.url, 900, 3), agg(common.url, 900, 9)] })
    expect(sibs).toHaveLength(0)
  })

  it('ignores pages with negligible traffic', () => {
    expect(findSiblings({ ...base, pageAgg: [agg(SELF.url, 2386, 4), agg(SIB1.url, 20, 0)] })).toHaveLength(0)
  })
})

describe('diagnoseCtrGap', () => {
  it('siblings win when present', () => {
    const d = diagnoseCtrGap({ ...base, queries: [q('liziba station', 900, 3, 7)] })
    expect(d.cause).toBe('siblings')
  })

  it('majority of impressions from queries ranking 8+ → low_rank_queries (a ranking problem, not a title problem)', () => {
    const d = diagnoseCtrGap({
      ...base, sitePages: [UNRELATED, ...filler], pageAgg: [agg(UNRELATED.url, 3153, 41)],
      page: { url: UNRELATED.url, impressions: 3153 }, title: UNRELATED.title,
      queries: [q('how many days in chongqing', 400, 4, 9.2), q('chongqing itinerary', 300, 2, 10.1), q('days chongqing', 100, 5, 5)],
    })
    expect(d.cause).toBe('low_rank_queries')
    expect(d.lowRankShare).toBeCloseTo(700 / 800, 2)
  })

  it('top query absent from the title → title_mismatch, naming the query; branded queries are never "missing"', () => {
    const lonely = page('https://x.com/best-time', 'Month-by-Month Guide')
    const d = diagnoseCtrGap({
      page: { url: lonely.url, impressions: 1000 }, title: lonely.title, live: liveOf('Month-by-Month Guide | Acme Tours'), sitePages: [lonely, ...filler], pageAgg: [agg(lonely.url, 1000, 6)],
      brandRoot: 'acme', brandAliases: ['acme'],
      queries: [q('acme tours', 500, 40, 2), q('best time to visit china', 300, 3, 6), q('china weather by month', 100, 1, 6)],
    })
    expect(d.cause).toBe('title_mismatch')
    expect(d.titleMisses).toContain('best time to visit china')
    expect(d.titleMisses).not.toContain('acme tours')
    expect(d.brandedShare).toBeGreaterThan(0.4)
  })

  it('long title with otherwise-fine queries → title_truncated; no query data falls back to siblings/title checks and says so', () => {
    const long = page('https://x.com/long', 'Chongqing Night City: Why This Mountain Metropolis Glows After Dark In Winter')
    const ok = diagnoseCtrGap({
      page: { url: long.url, impressions: 800 }, title: long.title, live: liveOf(long.title ?? ''), sitePages: [long, ...filler], pageAgg: [agg(long.url, 800, 5)], brandRoot: 'acme', brandAliases: null,
      queries: [q('chongqing night city', 400, 4, 6)],
    })
    expect(ok.cause).toBe('title_truncated')
    const none = diagnoseCtrGap({ ...base, sitePages: [long, ...filler], pageAgg: [agg(long.url, 800, 5)], page: { url: long.url, impressions: 800 }, title: long.title, live: liveOf(long.title ?? ''), queries: null })
    expect(none.queriesAvailable).toBe(false)
    expect(none.cause).toBe('title_truncated')
    const plain = diagnoseCtrGap({ ...base, sitePages: [UNRELATED, ...filler], pageAgg: [agg(UNRELATED.url, 3153, 41)], page: { url: UNRELATED.url, impressions: 3153 }, title: UNRELATED.title, queries: [] })
    expect(plain.cause).toBe('no_query_data')
  })
})

describe('ctr_gap item with a diagnosis', () => {
  const ctx: ItemContext = { clientId: 'c1', goalId: 'g1', planWeek: '2026-10-05', snapshotDate: '2026-09-28', gscDay: '2026-09-29', intelligenceHref: 'https://app/x', pageImpressions: new Map() }
  const gap: CtrGapCandidate = { kind: 'ctr_gap', url: SELF.url, clicks: 4, impressions: 2386, position: 9.4, ctr: 0.0017, benchmark: 0.035, potentialClicks: 80 }

  it('names the cause, lists the siblings as evidence, and tells the person to fix the cannibalisation first', () => {
    const d = diagnoseCtrGap({ ...base, queries: [q('liziba station', 900, 3, 9)] })
    const it = buildCtrGapItem(gap, SELF, ctx, 0, d)
    expect(it.description).toContain('【系统诊断】同主题有别的自家页面在分食曝光')
    expect(it.description).toContain(SIB1.url)
    expect(it.description).toContain('先处理分食')
    expect(it.description).toContain('「liziba station」曝光900')
    expect(it.stepsJson.ctr_diagnosis).toBeDefined()
    expect(it.description).not.toMatch(/点击率.*提升.*倍|带来.*点击/)
  })

  it('without a diagnosis the item keeps the generic steps (no regression)', () => {
    const it = buildCtrGapItem(gap, SELF, ctx, 0)
    expect(it.description).not.toContain('【系统诊断】')
    expect(it.description).toContain('分食同一主题')
  })
})

describe('live <title> is the only source of title facts', () => {
  const longCrawl = page('https://x.com/p', 'T'.repeat(90)) // crawler "title" (really the H1) is long …
  it('a long crawler title is IGNORED when the live <title> is short — no false truncation claim', () => {
    const d = diagnoseCtrGap({
      page: { url: longCrawl.url, impressions: 800 }, title: longCrawl.title, live: liveOf('Short live title | Acme Tours'),
      sitePages: [longCrawl, ...filler], pageAgg: [agg(longCrawl.url, 800, 5)], brandRoot: 'acme', brandAliases: ['acme'], queries: [q('short live title', 300, 3, 6)],
    })
    expect(d.titleTruncated).toBe(false)
    expect(d.titleSource).toBe('live')
    expect(d.quickFixes).toHaveLength(0)
  })
  it('no live title → titleSource unavailable, no length / mismatch claims at all (never falls back to the crawler heading)', () => {
    const d = diagnoseCtrGap({
      page: { url: longCrawl.url, impressions: 800 }, title: longCrawl.title, live: null,
      sitePages: [longCrawl, ...filler], pageAgg: [agg(longCrawl.url, 800, 5)], brandRoot: 'acme', brandAliases: null, queries: [q('something else', 300, 3, 6)],
    })
    expect(d.titleSource).toBe('unavailable')
    expect(d.titleTruncated).toBe(false)
    expect(d.titleMisses).toEqual([])
    expect(d.liveTitle).toBeNull()
  })
  it('duplicate brand tail and over-long live title become quick fixes; the item shows the live title as evidence', () => {
    const live = liveOf('Liziba Station Chongqing: Train Through a Building | CTS | CTS Tours')
    const d = diagnoseCtrGap({ page: { url: SELF.url, impressions: 2386 }, title: SELF.title, live, sitePages, pageAgg, brandRoot: 'ctstours', brandAliases: ['cts', 'cts tours'], queries: [q('liziba station', 900, 3, 9)] })
    expect(d.quickFixes.join('；')).toContain('品牌后缀重复')
    expect(d.quickFixes.join('；')).toContain('超过约 60')
    const ctx: ItemContext = { clientId: 'c1', goalId: 'g1', planWeek: '2026-10-05', snapshotDate: '2026-09-28', gscDay: '2026-09-29', intelligenceHref: 'https://app/x', pageImpressions: new Map() }
    const gap: CtrGapCandidate = { kind: 'ctr_gap', url: SELF.url, clicks: 4, impressions: 2386, position: 9.4, ctr: 0.0017, benchmark: 0.035, potentialClicks: 80 }
    const it = buildCtrGapItem(gap, SELF, ctx, 0, d)
    expect(it.description).toContain('【顺手可修】')
    expect(it.description).toContain('线上真实标题：「Liziba Station Chongqing: Train Through a Building | CTS | CTS Tours」')
    expect(it.description).not.toContain('A Complete Visitor Guide') // the crawler heading is never shown as the title
  })
})

