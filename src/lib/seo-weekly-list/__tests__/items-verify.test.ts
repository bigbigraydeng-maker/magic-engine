import { describe, expect, it } from 'vitest'
import { DEFAULT_SEO_LOOP_CONFIG } from '../config'
import { buildCtrGapItem, buildNearMissItem, PLAN_ACTION, type ItemContext } from '../items'
import { verifyPlanItem, type BlogRow, type CrawledPage } from '../verify'
import type { CtrGapCandidate, NearMissCandidate } from '../candidates'

const ctx: ItemContext = {
  clientId: 'c1', goalId: 'g1', planWeek: '2026-10-05', snapshotDate: '2026-09-28', gscDay: '2026-09-29',
  intelligenceHref: 'https://app.example/dashboard/clients/c1/seo-intelligence', pageImpressions: new Map(),
}
const member = (keyword: string, position: number, volume: number) => ({ keyword, position, volume, kd: 2, intent: 'informational' })
const near = (members = [member('nz visa china', 18, 400), member('nz china visa', 18, 390)]): NearMissCandidate =>
  ({ kind: 'near_miss', primary: members[0], members, potentialClicks: 9 })
const page = (url: string, title: string | null = 'A page', word_count = 800) => ({ url, path: new URL(url).pathname, title, h1: null, word_count })

describe('buildNearMissItem', () => {
  it('no matching own page → draft_post, keyword TOP-LEVEL, evidence labelled, failure criterion, no click attribution', () => {
    const it = buildNearMissItem(near(), [], ctx, 0)
    expect(it.actionType).toBe(PLAN_ACTION.DRAFT_POST)
    expect(it.keyword).toBe('nz visa china')
    expect(it.url).toBeNull()
    expect(it.stepsJson.loop).toBe('seo_goal_v1')
    expect(it.stepsJson.keyword).toBe('nz visa china')
    expect((it.stepsJson.verify as { type: string }).type).toBe('blog_published')
    expect(it.description).toMatch(/【怎么做】[\s\S]*【怎么算没起效】[\s\S]*【证据】[\s\S]*【链接】/)
    expect(it.description).toContain('〔确认｜')
    expect(it.description).toContain('〔假设｜') // zero text matches ≠ "no such page" (synonyms)
    expect(it.description).toContain('不认同义词')
    expect(it.description).toContain('同一意思的其他说法已并入本项')
    expect(it.description).toContain('只用于排序，不是预测')
    expect(it.description).not.toMatch(/带来.*点击/)
  })

  it('matching pages → strengthen_page on the page with most impressions; ≥2 matches adds the cannibalisation step', () => {
    const a = page('https://x.com/a')
    const b = page('https://x.com/b')
    const impressions = new Map([['x.com/b', 900], ['x.com/a', 100]])
    const it = buildNearMissItem(near(), [a, b], { ...ctx, pageImpressions: impressions }, 1)
    expect(it.actionType).toBe(PLAN_ACTION.STRENGTHEN_PAGE)
    expect(it.url).toBe('https://x.com/b')
    expect(it.description).toMatch(/先决定哪页当主页/)
    expect((it.stepsJson.verify as { type: string }).type).toBe('page_strengthened')
  })

  it('due dates fall Tue–Fri of the plan week', () => {
    const dues = [0, 1, 2, 3, 4].map(i => buildNearMissItem(near(), [], ctx, i).dueDate)
    expect(dues).toEqual(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-06'])
  })
})

describe('buildCtrGapItem', () => {
  const gap: CtrGapCandidate = { kind: 'ctr_gap', url: 'https://x.com/p', clicks: 2, impressions: 800, position: 6.2, ctr: 0.0025, benchmark: 0.035, potentialClicks: 26 }
  it('without live data the item makes NO claim about title length (the crawler "title" is the page heading, not the search title)', () => {
    const d = buildCtrGapItem(gap, page('https://x.com/p', 'T'.repeat(70)), ctx, 0)
    expect(d.description).not.toMatch(/70 个字符/)
    expect(d.description).toContain('这次没取到线上真实标题')
  })
  it('carries url top-level and no keyword', () => {
    const it = buildCtrGapItem(gap, undefined, ctx, 0)
    expect(it.url).toBe('https://x.com/p')
    expect(it.keyword).toBeNull()
    expect(it.stepsJson.url).toBe('https://x.com/p')
  })
})

describe('verifyPlanItem', () => {
  const cfg = DEFAULT_SEO_LOOP_CONFIG
  const created = '2026-10-05T00:00:00Z'
  const draftItem = { id: 'i1', created_at: created, steps_json: { keyword: 'nz visa china', verify: { type: 'blog_published' } } }
  const crawled = (over: Partial<CrawledPage> = {}): CrawledPage => ({
    url: 'https://x.com/blog/nz-visa-china', status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-12T00:00:00Z',
    word_count: 1200, ...over,
  })
  const post = (over: Partial<BlogRow> = {}): BlogRow => ({ primary_keyword: 'NZ Visa China', status: 'published', slug: 'nz-visa-china', published_at: '2026-10-08T00:00:00Z', ...over })

  it('blog_published: pending → not_measured (not crawled yet) → pass; case-insensitive keyword, ignores posts older than the item', () => {
    expect(verifyPlanItem(draftItem, { blogs: [], pages: [], config: cfg }).outcome).toBe('pending')
    expect(verifyPlanItem(draftItem, { blogs: [post({ published_at: '2026-09-01T00:00:00Z' })], pages: [], config: cfg }).outcome).toBe('pending')
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [crawled({ crawled_at: '2026-10-07T00:00:00Z' })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [crawled()], config: cfg }).outcome).toBe('pass')
  })

  it('blog_published: non-200, or a ~60-word anti-bot challenge page that crawled "fine", is not_measured — never pass', () => {
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [crawled({ status_code: 404 })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [crawled({ word_count: 63 })], config: cfg }).outcome).toBe('not_measured')
  })

  it('blog_published: the page must be EXACTLY the slug — slug "seo" must not match /seo-tips', () => {
    const item = { ...draftItem, steps_json: { keyword: 'seo', verify: { type: 'blog_published' } } }
    const wrong = crawled({ url: 'https://x.com/blog/seo-tips' })
    expect(verifyPlanItem(item, { blogs: [post({ primary_keyword: 'seo', slug: 'seo' })], pages: [wrong], config: cfg }).outcome).toBe('not_measured')
    const right = crawled({ url: 'https://x.com/blog/seo' })
    expect(verifyPlanItem(item, { blogs: [post({ primary_keyword: 'seo', slug: 'seo' })], pages: [right], config: cfg }).outcome).toBe('pass')
  })

  const strengthen = {
    id: 'i2', created_at: created,
    steps_json: { url: 'https://x.com/p', verify: { type: 'page_strengthened' }, baseline: { word_count: 800, crawled_at: '2026-10-04T12:00:00Z' } },
  }
  const pageNow = (over: Partial<CrawledPage> = {}): CrawledPage => ({
    url: 'https://x.com/p', status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-12T00:00:00Z', word_count: 800, ...over,
  })

  it('page_strengthened: no crawl after creation → not_measured; unchanged → pending; +100 words → pass', () => {
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ crawled_at: '2026-10-04T00:00:00Z' })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow()], config: cfg }).outcome).toBe('pending')
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ word_count: 950 })], config: cfg }).outcome).toBe('pass')
  })

  it('page_strengthened: a crawl that is not newer than the BASELINE crawl cannot show this item\'s work (stale-baseline false positive)', () => {
    // item created 10-05 but its baseline crawl was 10-06 (clock skew / late baseline): a 10-05 crawl must not count
    const late = { ...strengthen, steps_json: { ...strengthen.steps_json, baseline: { word_count: 800, crawled_at: '2026-10-11T00:00:00Z' } } }
    expect(verifyPlanItem(late, { blogs: [], pages: [pageNow({ word_count: 1100, crawled_at: '2026-10-10T00:00:00Z' })], config: cfg }).outcome).toBe('not_measured')
  })

  it('page_strengthened: navigation / link changes alone never verify (links are not a criterion)', () => {
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ word_count: 805 })], config: cfg }).outcome).toBe('pending')
  })

  it('page_strengthened: failed / suspiciously short crawl and missing baseline are not_measured', () => {
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ crawl_status: 'failed' })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ word_count: 63 })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem({ ...strengthen, steps_json: { url: 'https://x.com/p', verify: { type: 'page_strengthened' }, baseline: {} } }, { blogs: [], pages: [pageNow()], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [], config: cfg }).outcome).toBe('not_measured')
  })
})
