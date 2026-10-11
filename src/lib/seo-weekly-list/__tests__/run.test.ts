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
    initiatives: [{ id: 'ini-1', client_id: CID, goal_id: GOAL, is_archived: false, created_at: '2026-10-04T00:00:00Z' }],
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

  it('🔴 fail-closed: a malformed protected-page list withholds the whole client (it used to degrade to "protect nothing")', async () => {
    for (const bad of ['protected-page', [{ slug: 'protected-page' }], ['protected-page', 42]]) {
      const db = baseDb()
      db.rows('clients')[0].seo_config = { meta_cycle_protected_slugs: bad }
      const r = await runSeoWeeklyList(db.client(), { now: NOW })
      expect(r.results[0].withheld, JSON.stringify(bad)).toBe('protected_list_malformed')
      expect(db.rows('execution_items')).toHaveLength(0)
    }
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

  it('an open patrol card (or any open seo card) on the same keyword or page blocks a duplicate list item', async () => {
    const patrol = { id: 'p1', client_id: CID, dimension: 'seo', source: 'zhuge', status: 'pending', action_type: 'seo.refresh_blog',
      created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z', steps_json: { rule_id: 'stale_content', keyword: 'visa to china' } }
    const onPage = { ...patrol, id: 'p2', steps_json: { rule_id: 'not_indexed', url: 'https://x.com/low-ctr' } }
    const db = baseDb({ execution_items: [patrol, onPage] })
    await runSeoWeeklyList(db.client(), { now: NOW })
    const titles = db.rows('execution_items').filter(x => x.source === 'zhuge' && (x.steps_json as { loop?: string }).loop).map(x => String(x.title)).join(' | ')
    expect(titles).not.toContain('visa to china')
    expect(titles).not.toContain('low-ctr')
  })

  it('stale keyword snapshot (older than 14 days) → no new items, reason stale_snapshot', async () => {
    const db = baseDb()
    for (const r of db.rows('keyword_snapshots')) r.snapshot_date = '2026-09-10'
    const r = await runSeoWeeklyList(db.client(), { now: NOW })
    expect(r.results[0].withheld).toBe('stale_snapshot')
    expect(db.rows('execution_items')).toHaveLength(0)
  })

  it('a page whose crawl is too old to serve as a word-count baseline is not listed for strengthening', async () => {
    const db = baseDb()
    for (const p of db.rows('client_site_pages')) p.crawled_at = '2026-08-01T00:00:00Z'
    await runSeoWeeklyList(db.client(), { now: NOW })
    expect(db.rows('execution_items').some(x => (x.steps_json as { url: string | null }).url === 'https://x.com/low-ctr')).toBe(false)
  })

  it('a keyword item on a page with a fresh crawl is listed; the same page with a stale crawl (no trustworthy baseline) is not', async () => {
    const mk = (crawled_at: string) => {
      const db = baseDb()
      db.rows('keyword_snapshots').push({ client_id: CID, location_code: 2554, snapshot_date: '2026-09-28', keyword: 'great wall guide', position: 14, search_volume: 600, keyword_difficulty: 3, intent: 'informational' })
      db.rows('client_site_pages').push({ client_id: CID, url: 'https://x.com/great-wall-guide', path: '/great-wall-guide', title: 'Great wall guide', h1: null, word_count: 900, status_code: 200, crawl_status: 'crawled', crawled_at })
      return db
    }
    const fresh = mk('2026-10-03T00:00:00Z')
    await runSeoWeeklyList(fresh.client(), { now: NOW })
    const item = fresh.rows('execution_items').find(x => (x.steps_json as { url: string | null }).url === 'https://x.com/great-wall-guide')
    expect(item).toBeDefined()
    expect(((item!.steps_json as { baseline: { crawled_at: string; word_count: number } }).baseline)).toMatchObject({ crawled_at: '2026-10-03T00:00:00Z', word_count: 900 })
    const stale = mk('2026-08-01T00:00:00Z')
    await runSeoWeeklyList(stale.client(), { now: NOW })
    expect(stale.rows('execution_items').some(x => (x.steps_json as { url: string | null }).url === 'https://x.com/great-wall-guide')).toBe(false)
  })

  it('page-1 keyword with no word-matching page is skipped (a new article would compete with the page that ranks)', async () => {
    const db = baseDb()
    db.rows('keyword_snapshots').push({ client_id: CID, location_code: 2554, snapshot_date: '2026-09-28', keyword: 'imperial palace', position: 8, search_volume: 1300, keyword_difficulty: 7, intent: 'informational' })
    await runSeoWeeklyList(db.client(), { now: NOW })
    expect(db.rows('execution_items').some(x => String(x.title).includes('imperial palace'))).toBe(false)
  })

  it('an in_progress item is judged by last activity, not creation date; an item that could not be CHECKED gets twice the time', async () => {
    const base = { client_id: CID, dimension: 'seo', source: 'zhuge', action_type: 'seo.plan.draft_post', created_at: '2026-09-01T00:00:00Z' }
    const active = { ...base, id: 'a1', status: 'in_progress', updated_at: '2026-10-03T00:00:00Z', steps_json: { loop: SEO_PLAN_LOOP, keyword: 'k-active', verify: { type: 'blog_published' } } }
    // 20 days idle but pending-verify → expires; 20 days idle & not measurable (blog published, never crawled) → gets 2× (28d)
    const idle = { ...base, id: 'a2', status: 'pending', updated_at: '2026-09-15T00:00:00Z', steps_json: { loop: SEO_PLAN_LOOP, keyword: 'k-idle', verify: { type: 'blog_published' } } }
    const unmeasured = { ...base, id: 'a3', status: 'pending', updated_at: '2026-09-15T00:00:00Z', steps_json: { loop: SEO_PLAN_LOOP, keyword: 'k-unmeasured', verify: { type: 'blog_published' } } }
    const db = baseDb({
      execution_items: [active, idle, unmeasured],
      blog_posts: [{ client_id: CID, primary_keyword: 'k-unmeasured', status: 'published', slug: 'k-unmeasured', published_at: '2026-09-20T00:00:00Z' }],
    })
    await runSeoWeeklyList(db.client(), { now: NOW })
    const st = (id: string) => db.rows('execution_items').find(x => x.id === id)!.status
    expect(st('a1')).toBe('in_progress')
    expect(st('a2')).toBe('skipped')
    expect(st('a3')).toBe('pending')
  })

  it('inactive client is skipped without being counted as a failure; a failing item write is reported (cron turns red) but the run continues', async () => {
    const inactive = baseDb()
    inactive.rows('clients')[0].client_status = 'paused'
    const r1 = await runSeoWeeklyList(inactive.client(), { now: NOW })
    expect(r1.failed).toBe(0)

    const stale = { id: 's1', client_id: CID, dimension: 'seo', source: 'zhuge', status: 'pending', action_type: 'seo.plan.draft_post',
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', steps_json: { loop: SEO_PLAN_LOOP, keyword: 'old', verify: { type: 'blog_published' } } }
    const broken = baseDb({ execution_items: [stale] })
    broken.writeErrors.execution_logs = 'audit down'
    const r2 = await runSeoWeeklyList(broken.client(), { now: NOW })
    expect(r2.failed).toBe(1)
    expect(r2.results[0].item_errors?.[0]).toMatch(/audit down/)
    expect(broken.rows('execution_items').find(x => x.id === 's1')!.status).toBe('pending')
  })

  it('low-CTR items get a diagnosis from the page\'s own Google queries; at most 3 pages are read; a failed read does not block the item', async () => {
    const mkDb = () => {
      const db = baseDb()
      db.rows('gsc_performance_snapshots').push({ client_id: CID, period_end: '2026-10-03', site_url: 'https://x.com/' })
      return db
    }
    const calls: string[] = []
    const ok = await runSeoWeeklyList(mkDb().client(), {
      now: NOW,
      fetchPageQueries: async (_site, url) => { calls.push(url); return [{ query: 'low ctr page', clicks: 1, impressions: 25, ctr: 0.04, position: 5 }] },
    })
    expect(ok.failed).toBe(0)
    expect(calls.length).toBeLessThanOrEqual(3)
    expect(calls).toContain('https://x.com/low-ctr')

    const db2 = mkDb()
    await runSeoWeeklyList(db2.client(), { now: NOW, fetchPageQueries: async () => { throw new Error('google down') } })
    const item = db2.rows('execution_items').find(x => (x.steps_json as { url: string | null }).url === 'https://x.com/low-ctr')
    expect(item).toBeDefined()
    expect(String(item!.description)).toContain('没取到这页的搜索词数据')
  })

  it('a high-potential page whose crawl is too old is reported as a data gap instead of vanishing silently', async () => {
    const db = baseDb()
    db.rows('client_site_pages').find(p => p.url === 'https://x.com/low-ctr')!.crawled_at = '2026-08-01T00:00:00Z'
    const r = await runSeoWeeklyList(db.client(), { now: NOW, fetchPageQueries: async () => null })
    expect(r.results[0].stale_crawl_pages).toContain('https://x.com/low-ctr')
  })

  it('reads at most 3 pages\' queries per run even when many pages are eligible', async () => {
    const db = baseDb()
    db.rows('gsc_performance_snapshots').push({ client_id: CID, period_end: '2026-10-03', site_url: 'https://x.com/' })
    for (let i = 0; i < 6; i += 1) {
      const url = `https://x.com/extra-${i}`
      db.rows('client_site_pages').push({ client_id: CID, url, path: `/extra-${i}`, title: `Extra ${i}`, h1: null, word_count: 800, status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-03T00:00:00Z' })
      for (let d = 0; d < 28; d += 1) {
        const day = new Date('2026-09-29T00:00:00Z'); day.setUTCDate(day.getUTCDate() - d)
        db.rows('gsc_page_daily').push({ client_id: CID, day: day.toISOString().slice(0, 10), page_key: url, page_url: url, clicks: 0, impressions: 30 + i, position: 6 })
      }
    }
    const calls: string[] = []
    await runSeoWeeklyList(db.client(), { now: NOW, dryRun: true, fetchPageQueries: async (_s, url) => { calls.push(url); return null } })
    expect(calls.length).toBe(3)
  })

  it('the preview states the diagnosis cause and whether the Google query read worked', async () => {
    const mk = () => {
      const db = baseDb()
      db.rows('gsc_performance_snapshots').push({ client_id: CID, period_end: '2026-10-03', site_url: 'https://x.com/' })
      return db
    }
    const withRows = await runSeoWeeklyList(mk().client(), {
      now: NOW, dryRun: true,
      fetchPageQueries: async () => [{ query: 'low ctr page', clicks: 1, impressions: 25, ctr: 0.04, position: 5 }],
    })
    expect(withRows.results[0].preview.join('\n')).toContain('该页搜索词已取到')
    const failed = await runSeoWeeklyList(mk().client(), { now: NOW, dryRun: true, fetchPageQueries: async () => null })
    expect(failed.results[0].preview.join('\n')).toContain('该页搜索词没取到')
  })

  it('the preview states whether the live title was read; a failed live read degrades gracefully; at most 3 pages are fetched', async () => {
    const mk = () => {
      const db = baseDb()
      db.rows('gsc_performance_snapshots').push({ client_id: CID, period_end: '2026-10-03', site_url: 'https://x.com/' })
      return db
    }
    const urls: string[] = []
    const ok = await runSeoWeeklyList(mk().client(), {
      now: NOW, dryRun: true, fetchPageQueries: async () => null,
      fetchSnippet: async (u) => { urls.push(u); return { title: 'Low CTR | Acme | Acme Tours', description: 'd', canonical: null, noindex: false, status: 200 } },
    })
    expect(ok.results[0].preview.join('\n')).toContain('线上标题已取到')
    expect(ok.results[0].preview.join('\n')).toContain('顺手可修')
    expect(urls.length).toBeLessThanOrEqual(3)
    const bad = await runSeoWeeklyList(mk().client(), { now: NOW, dryRun: true, fetchPageQueries: async () => null, fetchSnippet: async () => { throw new Error('site down') } })
    expect(bad.failed).toBe(0)
    expect(bad.results[0].preview.join('\n')).toContain('线上标题没取到')
  })
})

