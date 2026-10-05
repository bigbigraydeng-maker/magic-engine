import { describe, expect, it } from 'vitest'
import { runSeoWeeklyList } from '../run'
import { FakeDb } from './fake-supabase'

const CID = 'c1'
const NOW = new Date('2026-10-05T04:30:00Z')
const GSC_DAY = '2026-09-29'

function dayOffset(n: number): string {
  const d = new Date(`${GSC_DAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** recent = days 0..27, prior = days 28..55. */
function gscRows(
  url: string,
  recent: { clicks: number; impressions: number; position: number } | null,
  prior: { clicks: number; impressions: number; position: number } | null,
  priorDays = 28,
) {
  const rows: Array<Record<string, unknown>> = []
  if (recent) for (let i = 0; i < 28; i += 1) rows.push({ client_id: CID, day: dayOffset(i), page_key: url, page_url: url, ...recent })
  if (prior) for (let i = 28; i < 28 + priorDays; i += 1) rows.push({ client_id: CID, day: dayOffset(i), page_key: url, page_url: url, ...prior })
  return rows
}

function db(gsc: Array<Record<string, unknown>>, pages: string[]) {
  return new FakeDb({
    goals: [{ id: 'g1', client_id: CID, primary_metric_key: 'seo_gsc_clicks_28d', status: 'active' }],
    initiatives: [{ id: 'ini-1', client_id: CID, goal_id: 'g1', is_archived: false, created_at: '2026-10-04T00:00:00Z' }],
    clients: [{ id: CID, client_status: 'active', domain: 'x.com', semrush_db: 'nz', brand_aliases: [], competitor_domains: [], seo_config: { meta_cycle_protected_slugs: ['protected-page'] } }],
    keyword_snapshots: [{ client_id: CID, location_code: 2554, snapshot_date: '2026-09-28', keyword: 'unrelated topic', position: 40, search_volume: 50, keyword_difficulty: 3, intent: 'informational' }],
    gsc_page_daily: gsc,
    client_site_pages: pages.map(p => ({ client_id: CID, url: `https://x.com/${p}`, path: `/${p}`, title: p, h1: null, word_count: 800, status_code: 200, crawl_status: 'crawled', crawled_at: '2026-10-01T00:00:00Z', markdown_content: '[a](/a)' })),
    seo_meta_log: [], execution_items: [], execution_logs: [], blog_posts: [],
  })
}

const A = 'https://x.com/decaying'
const STABLE = 'https://x.com/stable'
const gone = { clicks: 2, impressions: 20, position: 5 }

describe('weekly list · traffic decay source', () => {
  it('lists a page whose clicks fell far more than the site, with evidence and a page_changed check', async () => {
    const d = db([
      ...gscRows(A, { clicks: 0, impressions: 4, position: 9 }, gone),
      ...gscRows(STABLE, { clicks: 3, impressions: 30, position: 4 }, { clicks: 3, impressions: 30, position: 4 }),
    ], ['decaying', 'stable'])
    const r = await runSeoWeeklyList(d.client(), { now: NOW })
    expect(r.failed).toBe(0)
    expect(r.results[0].decay_note).toBeUndefined()
    const item = d.rows('execution_items').find(x => String(x.title).includes('流量下滑'))!
    expect(item).toBeDefined()
    expect(String(item.title)).toContain('/decaying')
    const steps = item.steps_json as Record<string, unknown> & { evidence: Array<{ confidence: string }>; verify: { type: string }; baseline: { word_count: number } }
    expect(steps.kind).toBe('traffic_decay')
    expect(steps.verify.type).toBe('page_changed')
    expect(steps.baseline.word_count).toBe(800)
    expect(steps.evidence[0].confidence).toBe('确认')
    expect(JSON.stringify(steps.evidence)).toContain('点击少了 100%')
    expect(d.rows('execution_items').some(x => String(x.title).includes('/stable'))).toBe(false)
  })

  it('a page that disappeared from Google entirely is still listed (0 clicks, not unknown)', async () => {
    const d = db([
      ...gscRows(A, null, gone),
      ...gscRows(STABLE, { clicks: 3, impressions: 30, position: 4 }, { clicks: 3, impressions: 30, position: 4 }),
    ], ['decaying', 'stable'])
    await runSeoWeeklyList(d.client(), { now: NOW })
    expect(d.rows('execution_items').some(x => String(x.title).includes('/decaying'))).toBe(true)
  })

  it('thin previous-window history switches the decay source off and says so — never a false "collapse"', async () => {
    const d = db([
      ...gscRows(A, { clicks: 0, impressions: 4, position: 9 }, gone, 10),
      ...gscRows(STABLE, { clicks: 3, impressions: 30, position: 4 }, { clicks: 3, impressions: 30, position: 4 }, 10),
    ], ['decaying', 'stable'])
    const r = await runSeoWeeklyList(d.client(), { now: NOW })
    expect(r.results[0].decay_note).toBe('prior_window_thin:10d')
    expect(d.rows('execution_items').some(x => String(x.title).includes('流量下滑'))).toBe(false)
  })

  it('a site-wide dip lists nothing (every page halved)', async () => {
    const d = db([
      ...gscRows(A, { clicks: 1, impressions: 10, position: 5 }, gone),
      ...gscRows(STABLE, { clicks: 2, impressions: 20, position: 4 }, { clicks: 4, impressions: 40, position: 4 }),
    ], ['decaying', 'stable'])
    await runSeoWeeklyList(d.client(), { now: NOW })
    expect(d.rows('execution_items').some(x => String(x.title).includes('流量下滑'))).toBe(false)
  })

  it('never lists a protected page, and a dry run writes nothing', async () => {
    const P = 'https://x.com/protected-page'
    const d = db([
      ...gscRows(P, { clicks: 0, impressions: 4, position: 9 }, gone),
      ...gscRows(STABLE, { clicks: 3, impressions: 30, position: 4 }, { clicks: 3, impressions: 30, position: 4 }),
    ], ['protected-page', 'stable'])
    await runSeoWeeklyList(d.client(), { now: NOW })
    expect(d.rows('execution_items').some(x => String(x.title).includes('protected-page'))).toBe(false)
    const d2 = db([
      ...gscRows(A, { clicks: 0, impressions: 4, position: 9 }, gone),
      ...gscRows(STABLE, { clicks: 3, impressions: 30, position: 4 }, { clicks: 3, impressions: 30, position: 4 }),
    ], ['decaying', 'stable'])
    const r = await runSeoWeeklyList(d2.client(), { now: NOW, dryRun: true })
    expect(r.results[0].preview.some(l => l.includes('流量下滑'))).toBe(true)
    expect(d2.rows('execution_items')).toHaveLength(0)
  })
})
