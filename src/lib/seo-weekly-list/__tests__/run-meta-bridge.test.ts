import { describe, expect, it } from 'vitest'
import { runSeoWeeklyList } from '../run'
import { SEO_PLAN_LOOP } from '@/lib/zhuge/action-persister'
import { FakeDb } from './fake-supabase'

const CID = 'c1'
const NOW = new Date('2026-10-12T04:30:00Z')
const URL = 'https://x.com/low-ctr'

function openCtrItem() {
  return {
    id: 'm1', client_id: CID, dimension: 'seo', source: 'zhuge', status: 'pending', action_type: 'seo.plan.strengthen_page',
    created_at: '2026-10-05T04:30:00Z', updated_at: '2026-10-05T04:30:00Z',
    steps_json: { loop: SEO_PLAN_LOOP, kind: 'ctr_gap', url: URL, keyword: null, verify: { type: 'page_changed' }, baseline: { word_count: 700, crawled_at: '2026-10-01T00:00:00Z' } },
  }
}

function db(metaRows: Array<Record<string, unknown>>) {
  return new FakeDb({
    goals: [{ id: 'g1', client_id: CID, primary_metric_key: 'seo_gsc_clicks_28d', status: 'active' }],
    initiatives: [{ id: 'ini-1', client_id: CID, goal_id: 'g1', is_archived: false, created_at: '2026-10-04T00:00:00Z' }],
    clients: [{ id: CID, client_status: 'active', domain: 'x.com', semrush_db: 'nz', brand_aliases: [], competitor_domains: [], seo_config: {} }],
    keyword_snapshots: [],
    gsc_page_daily: [],
    client_site_pages: [{ client_id: CID, url: URL, path: '/low-ctr', title: 'Low CTR page', h1: null, word_count: 700, status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-01T00:00:00Z', markdown_content: '' }],
    seo_meta_log: metaRows,
    execution_items: [openCtrItem()],
    execution_logs: [],
    blog_posts: [],
  })
}

describe('weekly list · bridge from the automatic title cycle', () => {
  it('an open low-CTR item whose page the cycle already changed live is completed with a receipt (the loop closes without a human)', async () => {
    const d = db([{ client_id: CID, page_url: `${URL}/`, optimised_at: '2026-10-08T05:40:00Z', reverted_at: null, pr_url: 'https://github.com/o/r/pull/9', applied_channel: 'pr' }])
    const r = await runSeoWeeklyList(d.client(), { now: NOW })
    expect(r.failed).toBe(0)
    expect(r.results[0].verified_pass).toBe(1)
    const row = d.rows('execution_items').find(x => x.id === 'm1')!
    expect(row.status).toBe('completed')
    const log = d.rows('execution_logs').find(l => l.execution_item_id === 'm1')!
    expect(JSON.stringify(log)).toContain('系统已自动改了这页的标题')
    expect(JSON.stringify(log)).toContain('pull/9')
  })

  it('a reverted edit does NOT close the item', async () => {
    const d = db([{ client_id: CID, page_url: URL, optimised_at: '2026-10-08T05:40:00Z', reverted_at: '2026-10-09T01:00:00Z', pr_url: null, applied_channel: 'pr' }])
    const r = await runSeoWeeklyList(d.client(), { now: NOW })
    expect(r.results[0].verified_pass).toBe(0)
    expect(d.rows('execution_items').find(x => x.id === 'm1')!.status).not.toBe('completed')
  })

  it('an edit logged for ANOTHER client or another page does not close it', async () => {
    const d = db([
      { client_id: CID, page_url: 'https://x.com/other', optimised_at: '2026-10-08T05:40:00Z', reverted_at: null, pr_url: null, applied_channel: 'pr' },
      { client_id: 'c2', page_url: URL, optimised_at: '2026-10-08T05:40:00Z', reverted_at: null, pr_url: null, applied_channel: 'pr' },
    ])
    const r = await runSeoWeeklyList(d.client(), { now: NOW })
    expect(r.results[0].verified_pass).toBe(0)
    expect(d.rows('execution_items').find(x => x.id === 'm1')!.status).not.toBe('completed')
  })

  it('a dry run reports the pass but writes nothing', async () => {
    const d = db([{ client_id: CID, page_url: URL, optimised_at: '2026-10-08T05:40:00Z', reverted_at: null, pr_url: null, applied_channel: 'pr' }])
    const r = await runSeoWeeklyList(d.client(), { now: NOW, dryRun: true })
    expect(r.results[0].verified_pass).toBe(1)
    expect(d.rows('execution_items').find(x => x.id === 'm1')!.status).toBe('pending')
    expect(d.rows('execution_logs')).toHaveLength(0)
  })

  it('newly listed low-CTR items are created with the page_changed check (so the bridge can close them later)', async () => {
    const gsc = Array.from({ length: 28 }, (_, i) => {
      const day = new Date('2026-10-09T00:00:00Z')
      day.setUTCDate(day.getUTCDate() - i)
      return { client_id: CID, day: day.toISOString().slice(0, 10), page_key: 'p', page_url: URL, clicks: 0, impressions: 30, position: 5 }
    })
    const d = new FakeDb({
      goals: [{ id: 'g1', client_id: CID, primary_metric_key: 'seo_gsc_clicks_28d', status: 'active' }],
      initiatives: [{ id: 'ini-1', client_id: CID, goal_id: 'g1', is_archived: false, created_at: '2026-10-04T00:00:00Z' }],
      clients: [{ id: CID, client_status: 'active', domain: 'x.com', semrush_db: 'nz', brand_aliases: [], competitor_domains: [], seo_config: {} }],
      keyword_snapshots: [{ client_id: CID, location_code: 2554, snapshot_date: '2026-10-09', keyword: 'unrelated', position: 40, search_volume: 50, keyword_difficulty: 3, intent: 'informational' }],
      gsc_page_daily: gsc,
      client_site_pages: [{ client_id: CID, url: URL, path: '/low-ctr', title: 'Low CTR page', h1: null, word_count: 700, status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-09T00:00:00Z', markdown_content: '' }],
      seo_meta_log: [], execution_items: [], execution_logs: [], blog_posts: [],
    })
    await runSeoWeeklyList(d.client(), { now: NOW })
    const created = d.rows('execution_items').filter(x => String(x.title).includes('点击率偏低'))
    expect(created.length).toBeGreaterThan(0)
    expect((created[0].steps_json as { verify: { type: string } }).verify.type).toBe('page_changed')
  })
})

