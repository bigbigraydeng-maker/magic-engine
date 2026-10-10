import { describe, expect, it } from 'vitest'
import { runSeoWeeklyList, type PageQueryFetcher } from '../run'
import { SEO_PLAN_LOOP } from '@/lib/zhuge/action-persister'
import { FakeDb } from './fake-supabase'

const CID = 'c1'
const GOAL = 'g1'
const NOW = new Date('2026-10-05T04:30:00Z') // Monday (NZ)

function makeDb(): FakeDb {
  const gsc = (pageKey: string, pageUrl: string) =>
    Array.from({ length: 28 }, (_, i) => {
      const d = new Date('2026-09-29T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - i)
      return {
        client_id: CID,
        day: d.toISOString().slice(0, 10),
        page_key: pageKey,
        page_url: pageUrl,
        clicks: 1,
        impressions: 40,
        position: 12,
      }
    })
  return new FakeDb({
    goals: [{ id: GOAL, client_id: CID, primary_metric_key: 'seo_gsc_clicks_28d', status: 'active' }],
    initiatives: [{ id: 'ini-1', client_id: CID, goal_id: GOAL, is_archived: false, created_at: '2026-10-04T00:00:00Z' }],
    clients: [{
      id: CID,
      client_status: 'active',
      domain: 'x.com',
      semrush_db: 'nz',
      brand_aliases: ['acme'],
      competitor_domains: [],
      seo_config: {},
    }],
    keyword_snapshots: [{
      client_id: CID,
      location_code: 2554,
      snapshot_date: '2026-09-28',
      keyword: 'visa to china',
      position: 18,
      search_volume: 390,
      keyword_difficulty: 3,
      intent: 'informational',
    }],
    client_site_pages: [
      {
        client_id: CID,
        url: 'https://x.com/visa-guide',
        path: '/visa-guide',
        title: 'Visa to China guide',
        h1: null,
        word_count: 900,
        status_code: 200,
        crawl_status: 'crawled',
        crawled_at: '2026-10-01T00:00:00Z',
        markdown_content: '[a](/a)',
      },
      {
        client_id: CID,
        url: 'https://x.com/visa-faq',
        path: '/visa-faq',
        title: 'Visa to China FAQ',
        h1: null,
        word_count: 900,
        status_code: 200,
        crawl_status: 'crawled',
        crawled_at: '2026-10-01T00:00:00Z',
        markdown_content: '[a](/a)',
      },
    ],
    gsc_page_daily: [
      ...gsc('p1', 'https://x.com/visa-guide'),
      ...gsc('p2', 'https://x.com/visa-faq'),
    ],
    gsc_performance_snapshots: [{ client_id: CID, site_url: 'https://x.com/', period_end: '2026-09-29' }],
    seo_meta_log: [],
    execution_items: [],
    execution_logs: [],
    blog_posts: [],
  })
}

function stepsOf(row: Record<string, unknown>): Record<string, unknown> {
  return row.steps_json as Record<string, unknown>
}

describe('runSeoWeeklyList pre-diagnosis and topic map', () => {
  it('only one page has the keyword in its queries → proceed verdict and prediagnosed_keywords = 1', async () => {
    const db = makeDb()
    const calls: string[] = []
    const fetchPageQueries: PageQueryFetcher = async (_site, pageUrl) => {
      calls.push(pageUrl)
      if (pageUrl === 'https://x.com/visa-guide') {
        return [{ query: 'visa to china', clicks: 2, impressions: 50, ctr: 0.04, position: 17 }]
      }
      return []
    }
    const r = await runSeoWeeklyList(db.client(), { now: NOW, fetchPageQueries, fetchSnippet: async () => null })
    expect(r.failed).toBe(0)
    expect(r.results[0].prediagnosed_keywords).toBe(1)
    const item = db.rows('execution_items').find(x => String(x.title).includes('visa to china'))
    expect(item).toBeDefined()
    expect(String(item!.description)).toContain('【系统预诊断】可直接按这页处理')
    const prediag = stepsOf(item!).prediagnosis as Record<string, unknown>
    expect(prediag.verdict).toBe('proceed')
  })

  it('both pages have the keyword in their queries → human_review and split = true', async () => {
    const db = makeDb()
    const fetchPageQueries: PageQueryFetcher = async () => [
      { query: 'visa to china', clicks: 2, impressions: 50, ctr: 0.04, position: 17 },
    ]
    const r = await runSeoWeeklyList(db.client(), { now: NOW, fetchPageQueries, fetchSnippet: async () => null })
    expect(r.failed).toBe(0)
    const item = db.rows('execution_items').find(x => String(x.title).includes('visa to china'))
    expect(item).toBeDefined()
    expect(String(item!.description)).toContain('需要人先看一眼')
    const prediag = stepsOf(item!).prediagnosis as Record<string, unknown>
    expect(prediag.split).toBe(true)
  })

  it('fetcher returns null for every page → human_review and an assumption evidence entry mentioning 没读到', async () => {
    const db = makeDb()
    const fetchPageQueries: PageQueryFetcher = async () => null
    const r = await runSeoWeeklyList(db.client(), { now: NOW, fetchPageQueries, fetchSnippet: async () => null })
    expect(r.failed).toBe(0)
    const item = db.rows('execution_items').find(x => String(x.title).includes('visa to china'))
    expect(item).toBeDefined()
    expect(String(item!.description)).toContain('需要人先看一眼')
    const evidence = stepsOf(item!).evidence as Array<Record<string, unknown>>
    expect(Array.isArray(evidence)).toBe(true)
    const assumption = evidence.find(e => e.confidence === '假设')
    expect(assumption).toBeDefined()
    expect(String(assumption!.claim)).toContain('没读到')
  })

  it('no gsc_performance_snapshots row → fetcher never called, prediagnosed_keywords = 0, no pre-diagnosis block', async () => {
    const db = makeDb()
    db.rows('gsc_performance_snapshots').length = 0
    const calls: string[] = []
    const fetchPageQueries: PageQueryFetcher = async (_site, pageUrl) => {
      calls.push(pageUrl)
      return null
    }
    const r = await runSeoWeeklyList(db.client(), { now: NOW, fetchPageQueries, fetchSnippet: async () => null })
    expect(r.failed).toBe(0)
    expect(calls).toHaveLength(0)
    expect(r.results[0].prediagnosed_keywords).toBe(0)
    const item = db.rows('execution_items').find(x => String(x.title).includes('visa to china'))
    expect(item).toBeDefined()
    expect(String(item!.description)).not.toContain('【系统预诊断】')
  })

  it('dry run writes nothing and reports a topic map with overlap for the shared keyword', async () => {
    const db = makeDb()
    const fetchPageQueries: PageQueryFetcher = async () => null
    const r = await runSeoWeeklyList(db.client(), { now: NOW, dryRun: true, fetchPageQueries, fetchSnippet: async () => null })
    expect(db.rows('execution_items')).toHaveLength(0)
    const topicMap = r.results[0].topic_map
    expect(Array.isArray(topicMap)).toBe(true)
    expect(topicMap).toHaveLength(1)
    const entry = (topicMap ?? [])[0]
    expect(entry?.keyword).toBe('visa to china')
    expect(entry?.overlap).toBe(true)
  })

  it('fetcher throws for every call → run still succeeds and the item asks for human review', async () => {
    const db = makeDb()
    const fetchPageQueries: PageQueryFetcher = async () => {
      throw new Error('google down')
    }
    const r = await runSeoWeeklyList(db.client(), { now: NOW, fetchPageQueries, fetchSnippet: async () => null })
    expect(r.failed).toBe(0)
    const item = db.rows('execution_items').find(x => String(x.title).includes('visa to china'))
    expect(item).toBeDefined()
    expect(String(item!.description)).toContain('需要人先看一眼')
  })
})
