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
    expect(it.description).toContain('未经验证的估算')
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
  it('flags a title over 60 chars as truncated, and says length is fine when it is not', () => {
    const long = 'T'.repeat(70)
    expect(buildCtrGapItem(gap, page('https://x.com/p', long), ctx, 0).description).toMatch(/70 个字符[\s\S]*截断/)
    expect(buildCtrGapItem(gap, page('https://x.com/p', 'Short title'), ctx, 0).description).toMatch(/不会被截断/)
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
    word_count: 1200, markdown_content: 'hello', ...over,
  })
  const post = (over: Partial<BlogRow> = {}): BlogRow => ({ primary_keyword: 'NZ Visa China', status: 'published', slug: 'nz-visa-china', published_at: '2026-10-08T00:00:00Z', ...over })

  it('blog_published: pending → not_measured (not crawled yet) → pass; case-insensitive keyword, ignores posts older than the item', () => {
    expect(verifyPlanItem(draftItem, { blogs: [], pages: [], config: cfg }).outcome).toBe('pending')
    expect(verifyPlanItem(draftItem, { blogs: [post({ published_at: '2026-09-01T00:00:00Z' })], pages: [], config: cfg }).outcome).toBe('pending')
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [crawled({ crawled_at: '2026-10-07T00:00:00Z' })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [crawled()], config: cfg }).outcome).toBe('pass')
  })

  it('blog_published: a blocked / non-200 crawl is not_measured, never pass', () => {
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [crawled({ status_code: 404 })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(draftItem, { blogs: [post()], pages: [crawled({ markdown_content: 'Robot Challenge Screen' })], config: cfg }).outcome).toBe('not_measured')
  })

  const strengthen = {
    id: 'i2', created_at: created,
    steps_json: { url: 'https://x.com/p', verify: { type: 'page_strengthened' }, baseline: { word_count: 800, link_count: 3 } },
  }
  const pageNow = (over: Partial<CrawledPage> = {}): CrawledPage => ({
    url: 'https://x.com/p', status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-12T00:00:00Z', word_count: 800,
    markdown_content: '[a](/a) [b](/b) [c](/c)', ...over,
  })

  it('page_strengthened: no crawl after creation → not_measured; unchanged → pending; +words or +links → pass', () => {
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ crawled_at: '2026-10-04T00:00:00Z' })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow()], config: cfg }).outcome).toBe('pending')
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ word_count: 950 })], config: cfg }).outcome).toBe('pass')
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ markdown_content: '[a](/a) [b](/b) [c](/c) [d](/d) [e](/e)' })], config: cfg }).outcome).toBe('pass')
  })

  it('page_strengthened: failed or blocked crawl and missing baseline are not_measured', () => {
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [pageNow({ crawl_status: 'failed' })], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem({ ...strengthen, steps_json: { url: 'https://x.com/p', verify: { type: 'page_strengthened' }, baseline: {} } }, { blogs: [], pages: [pageNow()], config: cfg }).outcome).toBe('not_measured')
    expect(verifyPlanItem(strengthen, { blogs: [], pages: [], config: cfg }).outcome).toBe('not_measured')
  })
})
