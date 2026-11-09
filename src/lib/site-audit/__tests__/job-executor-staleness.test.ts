/**
 * Cap handling + meta_description write in the site-audit executor.
 * Own file: job-executor.test.ts is already past the 800-line cap.
 * Regression for 2026-10-05: CTS sitemap 179 pages / cap 150 starved the same
 * tail every week with no visible sign, and meta_description was never written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../job-runner', () => ({ JobRunner: vi.fn() }))
vi.mock('../crawler', () => ({ discoverSitemapUrls: vi.fn(), crawlPages: vi.fn() }))
vi.mock('../classifier', () => ({ classifyPage: vi.fn() }))
vi.mock('../geo-detector', () => ({ detectGEOBlock: vi.fn() }))

import { executeJob, crawlAndClassifyPages } from '../job-executor'
import { JobRunner } from '../job-runner'
import { discoverSitemapUrls, crawlPages } from '../crawler'
import { classifyPage } from '../classifier'
import { detectGEOBlock } from '../geo-detector'

const U = (p: string) => `https://example.com${p}`

function makeSupabase(history: Array<{ url: string; crawled_at: string | null; crawl_status?: string }> | 'throw') {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
  // Mirrors the paginated read: select().eq().order().range(from, to) over `history`.
  const range = history === 'throw'
    ? vi.fn().mockRejectedValue(new Error('boom'))
    : vi.fn().mockImplementation((from: number, to: number) =>
        Promise.resolve({ data: history.slice(from, to + 1), error: null }))
  const order = vi.fn().mockReturnValue({ range })
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) })
  const from = vi.fn().mockReturnValue({ upsert, select })
  return { from, upsert, range } as unknown as SupabaseClient & {
    upsert: ReturnType<typeof vi.fn>
    range: ReturnType<typeof vi.fn>
  }
}

function makeRunner(maxPages: number) {
  return {
    startJob: vi.fn().mockResolvedValue({
      id: 'job-1', client_id: 'client-1', domain: 'example.com', max_pages: maxPages, rate_limit_ms: 0,
    }),
    updateProgress: vi.fn().mockResolvedValue({}),
    completeJob: vi.fn().mockResolvedValue({}),
    failJob: vi.fn().mockResolvedValue({}),
  }
}

const crawlResult = (url: string, extra: Record<string, unknown> = {}) => ({
  url, markdown: '# T\n\nbody', title: 'T', statusCode: 200, crawledAt: new Date('2026-10-05T00:00:00Z'), ...extra,
})

beforeEach(() => {
  vi.mocked(classifyPage).mockResolvedValue({ page_type: 'blog', topics: [], primary_keyword: null, confidence: 0.9 })
  vi.mocked(detectGEOBlock).mockReturnValue({ has_geo_block: false, detection_method: null, confidence: 0 })
})
afterEach(() => vi.clearAllMocks())

describe('executeJob — cap handling', () => {
  it('crawls the stalest pages first, so the capped tail rotates in', async () => {
    const urls = [U('/a'), U('/b'), U('/c'), U('/d')]
    vi.mocked(discoverSitemapUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([])
    const runner = makeRunner(2)
    vi.mocked(JobRunner).mockImplementation(() => runner as never)
    const supabase = makeSupabase([
      { url: U('/a'), crawl_status: 'crawled', crawled_at: '2026-10-04T00:00:00Z' },
      { url: U('/b'), crawl_status: 'crawled', crawled_at: '2026-09-13T00:00:00Z' },
      { url: U('/c'), crawl_status: 'crawled', crawled_at: '2026-10-04T00:00:00Z' },
      { url: U('/d'), crawl_status: 'crawled', crawled_at: '2026-09-20T00:00:00Z' },
    ])

    await executeJob(supabase, 'job-1')

    const crawled = vi.mocked(crawlPages).mock.calls[0][0]
    expect(crawled.slice(0, 2)).toEqual([U('/b'), U('/d')])
  })

  it('reads crawl history past the first 1000 rows so old rows cannot hide a stale page', async () => {
    const urls = [U('/target'), U('/other')]
    vi.mocked(discoverSitemapUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([])
    vi.mocked(JobRunner).mockImplementation(() => makeRunner(1) as never)
    // 1200 rows: /target (stalest) sorts after the first 1000-row page, /other is fresh.
    const filler = Array.from({ length: 1199 }, (_, i) => ({
      url: U(`/old-${String(i).padStart(4, '0')}`), crawl_status: 'crawled', crawled_at: '2026-10-04T00:00:00Z',
    }))
    const history = [...filler, { url: U('/zz-last'), crawl_status: 'crawled', crawled_at: '2026-10-04T00:00:00Z' }]
    history.splice(1100, 0, { url: U('/target'), crawl_status: 'crawled', crawled_at: '2026-09-01T00:00:00Z' })
    history.splice(5, 0, { url: U('/other'), crawl_status: 'crawled', crawled_at: '2026-10-04T00:00:00Z' })
    const supabase = makeSupabase(history)

    await executeJob(supabase, 'job-1')

    expect(supabase.range).toHaveBeenCalledTimes(2)
    expect(vi.mocked(crawlPages).mock.calls[0][0][0]).toBe(U('/target'))
  })

  it('keeps sitemap order when crawl history cannot be read', async () => {
    const urls = [U('/a'), U('/b'), U('/c')]
    vi.mocked(discoverSitemapUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([])
    vi.mocked(JobRunner).mockImplementation(() => makeRunner(2) as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await executeJob(makeSupabase('throw'), 'job-1')

    expect(vi.mocked(crawlPages).mock.calls[0][0]).toEqual(urls.slice(0, 2))
    warn.mockRestore()
  })

  it('records on the completed job how many pages the cap left unrefreshed', async () => {
    const urls = [U('/a'), U('/b'), U('/c')]
    vi.mocked(discoverSitemapUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue(urls.slice(0, 2).map((u) => crawlResult(u)))
    const runner = makeRunner(2)
    vi.mocked(JobRunner).mockImplementation(() => runner as never)

    await executeJob(makeSupabase([]), 'job-1')

    expect(runner.completeJob).toHaveBeenCalledWith('job-1', [], expect.stringContaining('1 页这轮没刷新'))
  })

  it('writes no note when every discovered page fit under the cap', async () => {
    const urls = [U('/a'), U('/b')]
    vi.mocked(discoverSitemapUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue(urls.map((u) => crawlResult(u)))
    const runner = makeRunner(5)
    vi.mocked(JobRunner).mockImplementation(() => runner as never)

    await executeJob(makeSupabase([]), 'job-1')

    expect(runner.completeJob).toHaveBeenCalledWith('job-1', [])
  })
})

describe('crawlAndClassifyPages — meta_description', () => {
  beforeEach(() => vi.mocked(JobRunner).mockImplementation(() => makeRunner(10) as never))

  it('writes meta_description when the crawl captured one', async () => {
    vi.mocked(crawlPages).mockResolvedValue([crawlResult(U('/p'), { metaDescription: 'Snippet text.' })])
    const supabase = makeSupabase([])
    await crawlAndClassifyPages(supabase, 'client-1', [U('/p')], 'job-1', { maxPages: 10, rateLimitMs: 0 })
    expect(supabase.upsert.mock.calls[0][0].meta_description).toBe('Snippet text.')
  })

  it('leaves the column out when not captured, so an earlier value is not wiped', async () => {
    vi.mocked(crawlPages).mockResolvedValue([crawlResult(U('/p'), {})])
    const supabase = makeSupabase([])
    await crawlAndClassifyPages(supabase, 'client-1', [U('/p')], 'job-1', { maxPages: 10, rateLimitMs: 0 })
    expect(supabase.upsert.mock.calls[0][0]).not.toHaveProperty('meta_description')
  })

  it('writes null when the page is confirmed to have no description', async () => {
    vi.mocked(crawlPages).mockResolvedValue([crawlResult(U('/p'), { metaDescription: null })])
    const supabase = makeSupabase([])
    await crawlAndClassifyPages(supabase, 'client-1', [U('/p')], 'job-1', { maxPages: 10, rateLimitMs: 0 })
    expect(supabase.upsert.mock.calls[0][0].meta_description).toBeNull()
  })
})
