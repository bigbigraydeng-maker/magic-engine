import { describe, expect, it } from 'vitest'
import { runSeoWeeklyList, planWeekOf } from '../run'
import { SEO_PLAN_LOOP } from '@/lib/zhuge/action-persister'
import { FakeDb } from './fake-supabase'

const CID = 'c1'
const GOAL = 'g1'
const NOW = new Date('2026-10-05T04:30:00Z') // Monday (NZ)

function baseDb(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const snap = (keyword: string, position: number, vol: number, kd: number | null = 3, intent = 'informational') => ({
    client_id: CID, location_code: 2554, snapshot_date: '2026-09-28', keyword, position, search_volume: vol, keyword_difficulty: kd, intent,
  })
  const gsc = Array.from({ length: 28 }, (_, i) => {
    const d = new Date('2026-09-29T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - i)
    return { client_id: CID, day: d.toISOString().slice(0, 10), page_key: 'p', page_url: 'https://x.com/low-ctr', clicks: 0, impressions: 30, position: 5 }
  })
  return new FakeDb({
    goals: [{ id: GOAL, client_id: CID, primary_metric_key: 'seo_gsc_clicks_28d', status: 'active' }],
    initiatives: [{ id: 'ini-1', goal_id: GOAL, is_archived: false, created_at: '2026-10-04T00:00:00Z' }],
    clients: [{ id: CID, client_status: 'active', domain: 'x.com', semrush_db: 'nz', brand_aliases: ['acme'], competitor_domains: ['rivalco.com'],
      seo_config: { meta_cycle_protected_slugs: ['protected-page'] } }],
    keyword_snapshots: [
      snap('visa to china', 18, 390), snap('great wall tours', 12, 300), snap('acme tours', 9, 900),
      snap('protected topic', 14, 800), snap('rivalco china', 11, 700),
    ],
    gsc_page_daily: gsc,
    client_site_pages: [
      { client_id: CID, url: 'https://x.com/protected-page', path: '/protected-page', title: 'protected topic guide', h1: null, word_count: 900, status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-01T00:00:00Z', markdown_content: '[a](/a)' },
      { client_id: CID, url: 'https://x.com/low-ctr', path: '/low-ctr', title: 'Low CTR page', h1: null, word_count: 700, status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-01T00:00:00Z', markdown_content: '[a](/a) [b](/b)' },
    ],
    seo_meta_log: [],
    execution_items: [],
    execution_logs: [],
    blog_posts: [],
    ...extra,
  })
}

describe('runSeoWeeklyList', () => {
  it('planWeekOf gives the NZ Monday', () => {
    expect(planWeekOf(new Date('2026-10-07T20:00:00Z'))).toBe('2026-10-05') // Thu 08 Oct NZ
  })

  it('dry run computes the list and writes nothing', async () => {
    const db = baseDb()
    const r = await runSeoWeeklyList(db.client(), { now: NOW, dryRun: true })
    expect(r.results[0].preview.length).toBeGreaterThan(0)
    expect(db.rows('execution_items')).toHaveLength(0)
    expect(db.rows('execution_logs')).toHaveLength(0)
  })

  it('real run: lists data-backed items, skips brand / competitor-brand / protected-page items, links initiative', async () => {
    const db = baseDb()
    const r = await runSeoWeeklyList(db.client(), { now: NOW })
    expect(r.failed).toBe(0)
    const rows = db.rows('execution_items')
    const titles = rows.map(x => String(x.title)).join(' | ')
    expect(titles).toContain('visa to china')
    expect(titles).toContain('great wall tours')
    expect(titles).toContain('low-ctr')
    expect(titles).not.toMatch(/acme/)
    expect(titles).not.toMatch(/rivalco/)
    expect(titles).not.toMatch(/protected topic/)
    expect(rows.every(x => x.initiative_id === 'ini-1' && (x.steps_json as { loop: string }).loop === SEO_PLAN_LOOP)).toBe(true)
    expect(rows.length).toBeLessThanOrEqual(5)
    expect(r.results[0].skipped_keywords).toBeGreaterThan(0)
  })

  it('one page gets at most one item per week (keyword item and low-CTR item on the same page collapse)', async () => {
    const db = baseDb()
    db.rows('client_site_pages').push({ client_id: CID, url: 'https://x.com/low-ctr', path: '/low-ctr', title: 'visa to china low ctr', h1: null, word_count: 700, status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-01T00:00:00Z', markdown_content: '' })
    await runSeoWeeklyList(db.client(), { now: NOW })
    const onLowCtr = db.rows('execution_items').filter(x => (x.steps_json as { url: string | null }).url === 'https://x.com/low-ctr')
    expect(onLowCtr.length).toBeLessThanOrEqual(1)
  })

  it('a second run the same week adds nothing (open items are not re-listed)', async () => {
    const db = baseDb()
    await runSeoWeeklyList(db.client(), { now: NOW })
    const n = db.rows('execution_items').length
    const again = await runSeoWeeklyList(db.client(), { now: new Date(NOW.getTime() + 3_600_000) })
    expect(db.rows('execution_items')).toHaveLength(n)
    expect(again.results[0].inserted).toBe(0)
  })

  it('work-in-progress cap: no new items while too many are open', async () => {
    const open = Array.from({ length: 8 }, (_, i) => ({
      id: `o${i}`, client_id: CID, dimension: 'seo', source: 'zhuge', status: 'pending', action_type: 'seo.plan.draft_post',
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', steps_json: { loop: SEO_PLAN_LOOP, keyword: `k${i}` },
    }))
    const db = baseDb({ execution_items: open })
    const r = await runSeoWeeklyList(db.client(), { now: NOW })
    expect(r.results[0].withheld).toBe('wip_cap')
    expect(db.rows('execution_items')).toHaveLength(8)
  })

  it('an item untouched for >14 days is SKIPPED with a reason and an audit row — not silently superseded', async () => {
    const stale = { id: 's1', client_id: CID, dimension: 'seo', source: 'zhuge', status: 'pending', action_type: 'seo.plan.draft_post',
      created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z', steps_json: { loop: SEO_PLAN_LOOP, keyword: 'old thing', verify: { type: 'blog_published' } } }
    const db = baseDb({ execution_items: [stale] })
    const r = await runSeoWeeklyList(db.client(), { now: NOW })
    const row = db.rows('execution_items').find(x => x.id === 's1')!
    expect(row.status).toBe('skipped')
    expect((row.steps_json as { skip_reason: string }).skip_reason).toBe('expired_no_action')
    expect(db.rows('execution_logs').some(l => l.execution_item_id === 's1')).toBe(true)
    expect(r.results[0].expired).toBe(1)
  })

  it('verification completes a published-and-crawled blog item with a receipt', async () => {
    const item = { id: 'v1', client_id: CID, dimension: 'seo', source: 'zhuge', status: 'pending', action_type: 'seo.plan.draft_post',
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', steps_json: { loop: SEO_PLAN_LOOP, keyword: 'visa to china', verify: { type: 'blog_published' } } }
    const db = baseDb({
      execution_items: [item],
      blog_posts: [{ client_id: CID, primary_keyword: 'Visa To China', status: 'published', slug: 'visa-to-china', published_at: '2026-10-03T00:00:00Z' }],
    })
    db.rows('client_site_pages').push({ client_id: CID, url: 'https://x.com/blog/visa-to-china', path: '/blog/visa-to-china', title: 'x', h1: null, word_count: 1000, status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-04T00:00:00Z', markdown_content: 'ok' })
    const r = await runSeoWeeklyList(db.client(), { now: NOW })
    const row = db.rows('execution_items').find(x => x.id === 'v1')!
    expect(row.status).toBe('completed')
    expect((row.steps_json as { verify: { state: string } }).verify.state).toBe('pass')
    expect(r.results[0].verified_pass).toBe(1)
    // the verified keyword is in cooldown: it is not re-listed this run
    expect(db.rows('execution_items').filter(x => String(x.title).includes('visa to china') && x.status === 'pending')).toHaveLength(0)
  })

  it('skips a client with no active seo goal, and a failing read is reported per client (not thrown)', async () => {
    const none = baseDb()
    none.rows('goals')[0].status = 'archived'
    expect((await runSeoWeeklyList(none.client(), { now: NOW })).clients_processed).toBe(0)

    const broken = baseDb()
    broken.rows('keyword_snapshots').length = 0
    const r = await runSeoWeeklyList(broken.client(), { now: NOW })
    expect(r.results[0].withheld).toBe('no_snapshot')
  })
})
