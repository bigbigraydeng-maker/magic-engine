/**
 * job-executor.test.ts
 *
 * TDD test suite for the job-executor module (P8.0.5).
 * Tests are grouped by concern; all external I/O is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Module mocks ────────────────────────────────────────────────────────────
// Must be declared BEFORE the import so vitest hoisting works correctly.

vi.mock('../job-runner', () => ({
  JobRunner: vi.fn(),
}))

vi.mock('../crawler', () => ({
  discoverSitemapUrls: vi.fn(),
  crawlPages: vi.fn(),
}))

vi.mock('../classifier', () => ({
  classifyPage: vi.fn(),
}))

vi.mock('../geo-detector', () => ({
  detectGEOBlock: vi.fn(),
}))

// ─── Imports after mocks ─────────────────────────────────────────────────────

import {
  executeJob,
  discoverSitemapUrls,
  crawlAndClassifyPages,
  type ExecuteJobOptions,
} from '../job-executor'
import { JobRunner } from '../job-runner'
import {
  discoverSitemapUrls as crawlerDiscoverUrls,
  crawlPages,
} from '../crawler'
import { classifyPage } from '../classifier'
import type { ClassificationResult } from '../classifier'
import { detectGEOBlock } from '../geo-detector'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-123',
    client_id: 'client-abc',
    status: 'in_progress',
    domain: 'example.com',
    max_pages: 100,
    rate_limit_ms: 0, // zero so tests don't actually sleep
    total_urls_discovered: 0,
    total_urls_crawled: 0,
    total_pages_classified: 0,
    error_message: null,
    failed_urls: [],
    started_at: '2026-05-04T10:05:00Z',
    completed_at: null,
    created_at: '2026-05-04T10:00:00Z',
    updated_at: '2026-05-04T10:05:00Z',
    ...overrides,
  }
}

function makeCrawlResult(
  url: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    url,
    markdown: `# ${url}\n\nContent for ${url}`,
    title: `Page ${url}`,
    statusCode: 200,
    crawledAt: new Date('2026-05-04T10:10:00Z'),
    ...overrides,
  }
}

function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    page_type: 'landing',
    topics: ['topic1', 'topic2'],
    primary_keyword: 'example keyword',
    confidence: 0.9,
    ...overrides,
  }
}

function makeGeoResult(overrides: Record<string, unknown> = {}) {
  return {
    has_geo_block: false,
    detection_method: null,
    confidence: 0,
    ...overrides,
  }
}

/** Build a Supabase mock whose `.from(table).upsert(...)` resolves to success. */
function makeSupabaseMock(upsertError: unknown = null) {
  const upsertFn = vi.fn().mockResolvedValue({ data: null, error: upsertError })
  const fromFn = vi.fn().mockReturnValue({ upsert: upsertFn })
  return { from: fromFn, _upsert: upsertFn } as unknown as SupabaseClient & {
    _upsert: ReturnType<typeof vi.fn>
  }
}

// ─── Runner mock factory ──────────────────────────────────────────────────────

function makeRunnerMock(startJobResult?: unknown) {
  return {
    startJob: vi.fn().mockResolvedValue(startJobResult ?? makeMockJob()),
    updateProgress: vi.fn().mockResolvedValue(makeMockJob()),
    completeJob: vi.fn().mockResolvedValue(makeMockJob({ status: 'completed' })),
    failJob: vi.fn().mockResolvedValue(makeMockJob({ status: 'failed' })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: discoverSitemapUrls (re-export wrapper)
// ─────────────────────────────────────────────────────────────────────────────

describe('discoverSitemapUrls', () => {
  afterEach(() => vi.clearAllMocks())

  it('delegates to crawler.discoverSitemapUrls and returns URLs', async () => {
    const mockUrls = [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/contact',
    ]
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(mockUrls)

    const result = await discoverSitemapUrls('example.com')

    expect(crawlerDiscoverUrls).toHaveBeenCalledWith('example.com')
    expect(result).toEqual(mockUrls)
  })

  it('returns empty array when crawler finds no URLs', async () => {
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue([])

    const result = await discoverSitemapUrls('empty-site.com')

    expect(result).toEqual([])
  })

  it('propagates errors thrown by the underlying crawler', async () => {
    vi.mocked(crawlerDiscoverUrls).mockRejectedValue(
      new Error('Network timeout')
    )

    await expect(discoverSitemapUrls('unreachable.com')).rejects.toThrow(
      'Network timeout'
    )
  })

  it('handles domains with special characters gracefully', async () => {
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue([])
    await expect(
      discoverSitemapUrls('sub.domain-name.co.nz')
    ).resolves.toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: executeJob — main orchestration flow
// ─────────────────────────────────────────────────────────────────────────────

describe('executeJob', () => {
  let mockSupabase: ReturnType<typeof makeSupabaseMock>
  let mockRunner: ReturnType<typeof makeRunnerMock>

  beforeEach(() => {
    mockSupabase = makeSupabaseMock()
    mockRunner = makeRunnerMock()
    vi.mocked(JobRunner).mockImplementation(() => mockRunner as never)

    // Default: classifier and geo always succeed
    vi.mocked(classifyPage).mockResolvedValue(makeClassification())
    vi.mocked(detectGEOBlock).mockReturnValue(makeGeoResult())
  })

  afterEach(() => vi.clearAllMocks())

  // ── Happy path ───────────────────────────────────────────────────────────

  it('completes job successfully when all 3 URLs are crawled', async () => {
    const urls = [
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/contact',
    ]

    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue(
      urls.map(u => makeCrawlResult(u))
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.startJob).toHaveBeenCalledWith('job-123')
    expect(mockRunner.completeJob).toHaveBeenCalledWith('job-123')
    expect(mockRunner.failJob).not.toHaveBeenCalled()
  })

  it('calls updateProgress with total URLs discovered after discovery', async () => {
    const urls = Array.from(
      { length: 5 },
      (_, i) => `https://example.com/page${i}`
    )

    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue(
      urls.map(u => makeCrawlResult(u))
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.updateProgress).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ totalUrlsDiscovered: 5 })
    )
  })

  it('completes with zero counts when no URLs discovered', async () => {
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue([])

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.completeJob).toHaveBeenCalledWith('job-123')
    expect(crawlPages).not.toHaveBeenCalled()
  })

  // ── Discovery failure ────────────────────────────────────────────────────

  it('calls failJob when URL discovery throws', async () => {
    vi.mocked(crawlerDiscoverUrls).mockRejectedValue(
      new Error('sitemap.xml unreachable')
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.failJob).toHaveBeenCalledWith(
      'job-123',
      expect.stringContaining('sitemap.xml unreachable'),
      []
    )
    expect(mockRunner.completeJob).not.toHaveBeenCalled()
  })

  // ── Partial crawl failures ────────────────────────────────────────────────

  it('still calls completeJob when some pages fail to crawl', async () => {
    const urls = [
      'https://example.com/',
      'https://example.com/broken',
      'https://example.com/about',
    ]

    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([
      makeCrawlResult(urls[0]),
      makeCrawlResult(urls[1], { error: 'Connection refused', statusCode: 0 }),
      makeCrawlResult(urls[2]),
    ])

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.completeJob).toHaveBeenCalled()
    expect(mockRunner.failJob).not.toHaveBeenCalled()
  })

  // ── Classification fallback ──────────────────────────────────────────────

  it('falls back to "other" page type when classifyPage throws', async () => {
    const urls = ['https://example.com/']

    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([makeCrawlResult(urls[0])])
    vi.mocked(classifyPage).mockRejectedValue(
      new Error('OpenAI rate limit exceeded')
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    // Job must still complete — never fail due to classification error
    expect(mockRunner.completeJob).toHaveBeenCalled()
    expect(mockRunner.failJob).not.toHaveBeenCalled()

    // The upserted data should have fallback page_type
    const upsertCall = mockSupabase._upsert.mock.calls[0][0]
    expect(upsertCall.page_type).toBe('other')
  })

  // ── GEO detection fallback ───────────────────────────────────────────────

  it('stores null geo info when detectGEOBlock throws', async () => {
    const urls = ['https://example.com/']

    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([makeCrawlResult(urls[0])])
    vi.mocked(detectGEOBlock).mockImplementation(() => {
      throw new Error('Unexpected GEO error')
    })

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.completeJob).toHaveBeenCalled()

    const upsertCall = mockSupabase._upsert.mock.calls[0][0]
    expect(upsertCall.has_geo_block).toBe(false)
    expect(upsertCall.geo_detection_method).toBeNull()
  })

  // ── Unrecoverable error ──────────────────────────────────────────────────

  it('calls failJob when startJob itself throws', async () => {
    mockRunner.startJob.mockRejectedValue(new Error('DB connection lost'))

    await expect(
      executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')
    ).rejects.toThrow('DB connection lost')

    expect(mockRunner.failJob).not.toHaveBeenCalled() // can't recover without job data
  })

  // ── Input validation ─────────────────────────────────────────────────────

  it('throws immediately when jobId is empty string', async () => {
    await expect(
      executeJob(mockSupabase as unknown as SupabaseClient, '')
    ).rejects.toThrow('Job ID is required')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Progress updates — timing and accuracy
// ─────────────────────────────────────────────────────────────────────────────

describe('executeJob — progress updates', () => {
  let mockSupabase: ReturnType<typeof makeSupabaseMock>
  let mockRunner: ReturnType<typeof makeRunnerMock>

  beforeEach(() => {
    mockSupabase = makeSupabaseMock()
    mockRunner = makeRunnerMock()
    vi.mocked(JobRunner).mockImplementation(() => mockRunner as never)
    vi.mocked(classifyPage).mockResolvedValue(makeClassification())
    vi.mocked(detectGEOBlock).mockReturnValue(makeGeoResult())
  })

  afterEach(() => vi.clearAllMocks())

  it('triggers intermediate updateProgress at page 10 in a 15-page batch', async () => {
    const urls = Array.from(
      { length: 15 },
      (_, i) => `https://example.com/page${i}`
    )

    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue(
      urls.map(u => makeCrawlResult(u))
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    // At least one intermediate call at the 10-page mark, plus the discovery
    // update and the final flush
    const progressCalls = mockRunner.updateProgress.mock.calls.filter(
      ([, input]) => 'totalUrlsCrawled' in input
    )
    expect(progressCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('final updateProgress carries accurate totalPagesClassified count', async () => {
    const urls = Array.from(
      { length: 3 },
      (_, i) => `https://example.com/page${i}`
    )

    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue(
      urls.map(u => makeCrawlResult(u))
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    // At least one call with totalPagesClassified = 3
    const finalProgressCalls = mockRunner.updateProgress.mock.calls.filter(
      ([, input]) =>
        'totalPagesClassified' in input && input.totalPagesClassified === 3
    )
    expect(finalProgressCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('does not trigger intermediate progress when batch is smaller than interval', async () => {
    const urls = Array.from(
      { length: 5 },
      (_, i) => `https://example.com/page${i}`
    )

    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue(
      urls.map(u => makeCrawlResult(u))
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    // Only discovery update + final flush from crawlAndClassifyPages
    const crawlProgressCalls = mockRunner.updateProgress.mock.calls.filter(
      ([, input]) => 'totalUrlsCrawled' in input
    )
    // Should have final flush only (no intermediate at index 10)
    expect(crawlProgressCalls.length).toBe(2) // one from crawlAndClassify final flush + one from executeJob
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: Database writes — upsert correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('crawlAndClassifyPages — database writes', () => {
  let mockSupabase: ReturnType<typeof makeSupabaseMock>
  let mockRunner: ReturnType<typeof makeRunnerMock>

  beforeEach(() => {
    mockSupabase = makeSupabaseMock()
    mockRunner = makeRunnerMock()
    vi.mocked(JobRunner).mockImplementation(() => mockRunner as never)
    vi.mocked(classifyPage).mockResolvedValue(makeClassification())
    vi.mocked(detectGEOBlock).mockReturnValue(makeGeoResult())
  })

  afterEach(() => vi.clearAllMocks())

  it('upserts page data with correct fields for a successful crawl', async () => {
    const url = 'https://example.com/about'
    vi.mocked(crawlPages).mockResolvedValue([
      makeCrawlResult(url, {
        markdown: '# About us\n\nWe are a company.',
        title: 'About Us',
        statusCode: 200,
      }),
    ])
    vi.mocked(classifyPage).mockResolvedValue({
      page_type: 'about',
      topics: ['company', 'team'],
      primary_keyword: 'about us',
      confidence: 0.95,
    })
    vi.mocked(detectGEOBlock).mockReturnValue({
      has_geo_block: false,
      detection_method: null,
      confidence: 0,
    })

    await crawlAndClassifyPages(
      mockSupabase as unknown as SupabaseClient,
      'client-abc',
      [url],
      'job-123',
      { maxPages: 100, rateLimitMs: 0 }
    )

    expect(mockSupabase.from).toHaveBeenCalledWith('client_site_pages')
    const upsertArg = mockSupabase._upsert.mock.calls[0][0]

    expect(upsertArg).toMatchObject({
      client_id: 'client-abc',
      job_id: 'job-123',
      url,
      title: 'About Us',
      page_type: 'about',
      topics: ['company', 'team'],
      primary_keyword: 'about us',
      classification_confidence: 0.95,
      has_geo_block: false,
      status_code: 200,
    })
  })

  it('computes word_count from markdown content', async () => {
    const url = 'https://example.com/'
    const markdown = '# Home\n\nThis is a five word sentence.'
    vi.mocked(crawlPages).mockResolvedValue([
      makeCrawlResult(url, { markdown }),
    ])

    await crawlAndClassifyPages(
      mockSupabase as unknown as SupabaseClient,
      'client-abc',
      [url],
      'job-123',
      { maxPages: 100, rateLimitMs: 0 }
    )

    const upsertArg = mockSupabase._upsert.mock.calls[0][0]
    // markdown has 8 tokens: #, Home, This, is, a, five, word, sentence.
    expect(upsertArg.word_count).toBe(8)
  })

  it('records upsert failures in the failed array without stopping the batch', async () => {
    const urls = ['https://example.com/', 'https://example.com/about']

    const failingUpsert = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'constraint violation' } })
      .mockResolvedValueOnce({ data: null, error: null })

    const fromFn = vi.fn().mockReturnValue({ upsert: failingUpsert })
    const supabaseWithFailure = {
      from: fromFn,
      _upsert: failingUpsert,
    } as unknown as SupabaseClient & { _upsert: ReturnType<typeof vi.fn> }

    vi.mocked(crawlPages).mockResolvedValue(
      urls.map(u => makeCrawlResult(u))
    )

    const result = await crawlAndClassifyPages(
      supabaseWithFailure as unknown as SupabaseClient,
      'client-abc',
      urls,
      'job-123',
      { maxPages: 100, rateLimitMs: 0 }
    )

    expect(result.failed).toHaveLength(1)
    expect(result.successful).toHaveLength(1)
    expect(result.failed[0].url).toBe(urls[0])
  })

  it('does NOT upsert pages that failed to crawl (error field present)', async () => {
    const url = 'https://example.com/broken'
    vi.mocked(crawlPages).mockResolvedValue([
      makeCrawlResult(url, { error: 'Timeout', statusCode: 0, markdown: '' }),
    ])

    const result = await crawlAndClassifyPages(
      mockSupabase as unknown as SupabaseClient,
      'client-abc',
      [url],
      'job-123',
      { maxPages: 100, rateLimitMs: 0 }
    )

    expect(mockSupabase._upsert).not.toHaveBeenCalled()
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ url, error: 'Timeout' })
  })

  it('upserts GEO block info when detected', async () => {
    const url = 'https://example.com/'
    vi.mocked(crawlPages).mockResolvedValue([makeCrawlResult(url)])
    vi.mocked(detectGEOBlock).mockReturnValue({
      has_geo_block: true,
      detection_method: 'aria-hidden attribute',
      confidence: 0.95,
    })

    await crawlAndClassifyPages(
      mockSupabase as unknown as SupabaseClient,
      'client-abc',
      [url],
      'job-123',
      { maxPages: 100, rateLimitMs: 0 }
    )

    const upsertArg = mockSupabase._upsert.mock.calls[0][0]
    expect(upsertArg.has_geo_block).toBe(true)
    expect(upsertArg.geo_detection_method).toBe('aria-hidden attribute')
    expect(upsertArg.geo_confidence).toBe(0.95)
  })

  it('respects maxPages option and does not crawl more than the limit', async () => {
    const urls = Array.from(
      { length: 50 },
      (_, i) => `https://example.com/page${i}`
    )
    vi.mocked(crawlPages).mockResolvedValue(
      urls.slice(0, 10).map(u => makeCrawlResult(u))
    )

    await crawlAndClassifyPages(
      mockSupabase as unknown as SupabaseClient,
      'client-abc',
      urls,
      'job-123',
      { maxPages: 10, rateLimitMs: 0 }
    )

    // crawlPages should have been called with at most 10 URLs
    const crawlCallArg = vi.mocked(crawlPages).mock.calls[0][0]
    expect(crawlCallArg).toHaveLength(10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Client isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('crawlAndClassifyPages — client isolation', () => {
  afterEach(() => vi.clearAllMocks())

  it('tags each upserted page with the correct client_id', async () => {
    const url = 'https://acme.com/'
    const upsertFn = vi.fn().mockResolvedValue({ data: null, error: null })
    const fromFn = vi.fn().mockReturnValue({ upsert: upsertFn })
    const supabase = { from: fromFn } as unknown as SupabaseClient

    vi.mocked(JobRunner).mockImplementation(
      () =>
        ({
          updateProgress: vi.fn().mockResolvedValue({}),
        } as never)
    )
    vi.mocked(crawlPages).mockResolvedValue([makeCrawlResult(url)])
    vi.mocked(classifyPage).mockResolvedValue(makeClassification())
    vi.mocked(detectGEOBlock).mockReturnValue(makeGeoResult())

    await crawlAndClassifyPages(supabase, 'client-XYZ', [url], 'job-456', {
      maxPages: 100,
      rateLimitMs: 0,
    })

    const upsertArg = upsertFn.mock.calls[0][0]
    expect(upsertArg.client_id).toBe('client-XYZ')
  })

  it('two parallel crawls use different client_ids without cross-contamination', async () => {
    const urlA = 'https://brand-a.com/'
    const urlB = 'https://brand-b.com/'

    const upsertA = vi.fn().mockResolvedValue({ data: null, error: null })
    const upsertB = vi.fn().mockResolvedValue({ data: null, error: null })

    const supabaseA = {
      from: vi.fn().mockReturnValue({ upsert: upsertA }),
    } as unknown as SupabaseClient
    const supabaseB = {
      from: vi.fn().mockReturnValue({ upsert: upsertB }),
    } as unknown as SupabaseClient

    vi.mocked(JobRunner).mockImplementation(
      () =>
        ({
          updateProgress: vi.fn().mockResolvedValue({}),
        } as never)
    )
    vi.mocked(crawlPages)
      .mockResolvedValueOnce([makeCrawlResult(urlA)])
      .mockResolvedValueOnce([makeCrawlResult(urlB)])
    vi.mocked(classifyPage).mockResolvedValue(makeClassification())
    vi.mocked(detectGEOBlock).mockReturnValue(makeGeoResult())

    await Promise.all([
      crawlAndClassifyPages(supabaseA, 'client-A', [urlA], 'job-A', {
        maxPages: 100,
        rateLimitMs: 0,
      }),
      crawlAndClassifyPages(supabaseB, 'client-B', [urlB], 'job-B', {
        maxPages: 100,
        rateLimitMs: 0,
      }),
    ])

    expect(upsertA.mock.calls[0][0].client_id).toBe('client-A')
    expect(upsertB.mock.calls[0][0].client_id).toBe('client-B')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('executeJob — edge cases', () => {
  let mockSupabase: ReturnType<typeof makeSupabaseMock>
  let mockRunner: ReturnType<typeof makeRunnerMock>

  beforeEach(() => {
    mockSupabase = makeSupabaseMock()
    mockRunner = makeRunnerMock()
    vi.mocked(JobRunner).mockImplementation(() => mockRunner as never)
    vi.mocked(classifyPage).mockResolvedValue(makeClassification())
    vi.mocked(detectGEOBlock).mockReturnValue(makeGeoResult())
  })

  afterEach(() => vi.clearAllMocks())

  it('handles a single-page site correctly', async () => {
    const urls = ['https://single.com/']
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([makeCrawlResult(urls[0])])

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.completeJob).toHaveBeenCalled()
    expect(mockSupabase._upsert).toHaveBeenCalledTimes(1)
  })

  it('handles a page with empty markdown without crashing', async () => {
    const urls = ['https://example.com/empty']
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([
      makeCrawlResult(urls[0], { markdown: '' }),
    ])
    // classifyPage will throw because markdown is empty — must fallback
    vi.mocked(classifyPage).mockRejectedValue(
      new Error('Markdown content is required')
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.completeJob).toHaveBeenCalled()
  })

  it('handles unicode / emoji in page content without crashing', async () => {
    const urls = ['https://example.com/emoji']
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([
      makeCrawlResult(urls[0], {
        markdown: '# 你好 🎉\n\nContent with 中文 and emoji 🌟',
        title: 'Unicode Page 🌏',
      }),
    ])

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.completeJob).toHaveBeenCalled()
  })

  it('handles 100-page batch (boundary: maxPages default)', async () => {
    const urls = Array.from(
      { length: 100 },
      (_, i) => `https://large.com/page${i}`
    )
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue(
      urls.map(u => makeCrawlResult(u))
    )

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.completeJob).toHaveBeenCalled()
    // Should have multiple intermediate progress updates
    const progressCalls = mockRunner.updateProgress.mock.calls.filter(
      ([, input]) => 'totalUrlsCrawled' in input
    )
    expect(progressCalls.length).toBeGreaterThanOrEqual(10)
  })

  it('resolves options from the job record when not passed explicitly', async () => {
    const customJob = makeMockJob({ max_pages: 50, rate_limit_ms: 500 })
    mockRunner.startJob.mockResolvedValue(customJob)

    const urls = ['https://example.com/']
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([makeCrawlResult(urls[0])])

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    // crawlPages should have been called with maxPages from job record
    const crawlOptions = vi.mocked(crawlPages).mock.calls[0][1]
    expect(crawlOptions?.limit).toBe(50)
  })

  it('calls failJob with string error when crawlAndClassifyPages throws a non-Error value', async () => {
    const urls = ['https://example.com/']
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    // Force crawlPages to throw a string (non-Error object)
    vi.mocked(crawlPages).mockRejectedValue('raw string error')

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.failJob).toHaveBeenCalledWith(
      'job-123',
      'raw string error',
      []
    )
    expect(mockRunner.completeJob).not.toHaveBeenCalled()
  })

  it('uses DEFAULT_MAX_PAGES when job.max_pages is null and no options provided', async () => {
    // Simulate a job record where max_pages is null (edge case in DB)
    const jobWithNullPages = makeMockJob({
      max_pages: null as unknown as number,
      rate_limit_ms: null as unknown as number,
    })
    mockRunner.startJob.mockResolvedValue(jobWithNullPages)

    const urls = ['https://example.com/']
    vi.mocked(crawlerDiscoverUrls).mockResolvedValue(urls)
    vi.mocked(crawlPages).mockResolvedValue([makeCrawlResult(urls[0])])

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    // Should complete without error — defaults are applied
    expect(mockRunner.completeJob).toHaveBeenCalled()
    const crawlOptions = vi.mocked(crawlPages).mock.calls[0][1]
    expect(crawlOptions?.limit).toBe(100) // DEFAULT_MAX_PAGES
  })

  it('calls failJob with stringified non-Error when URL discovery throws a non-Error', async () => {
    // Discovery throws a plain object, not an Error
    vi.mocked(crawlerDiscoverUrls).mockRejectedValue({ code: 'ENOTFOUND' })

    await executeJob(mockSupabase as unknown as SupabaseClient, 'job-123')

    expect(mockRunner.failJob).toHaveBeenCalledWith(
      'job-123',
      expect.stringContaining('URL discovery failed'),
      []
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7: Progress update triggered on a failed page at the interval boundary
// ─────────────────────────────────────────────────────────────────────────────

describe('crawlAndClassifyPages — progress update on failed page at interval', () => {
  afterEach(() => vi.clearAllMocks())

  it('triggers updateProgress at index 9 even when that page failed to crawl', async () => {
    // Build 10 URLs where the 10th (index 9) has a crawl error
    const urls = Array.from(
      { length: 10 },
      (_, i) => `https://example.com/page${i}`
    )
    const crawlResults = urls.map((u, i) =>
      i === 9
        ? makeCrawlResult(u, { error: 'Timeout', statusCode: 0, markdown: '' })
        : makeCrawlResult(u)
    )

    const updateProgressFn = vi.fn().mockResolvedValue({})
    const supabase = makeSupabaseMock()

    vi.mocked(JobRunner).mockImplementation(
      () =>
        ({
          updateProgress: updateProgressFn,
        } as never)
    )
    vi.mocked(crawlPages).mockResolvedValue(crawlResults)
    vi.mocked(classifyPage).mockResolvedValue(makeClassification())
    vi.mocked(detectGEOBlock).mockReturnValue(makeGeoResult())

    const result = await crawlAndClassifyPages(
      supabase as unknown as SupabaseClient,
      'client-abc',
      urls,
      'job-123',
      { maxPages: 100, rateLimitMs: 0 }
    )

    // The interval update at index 9 AND the final flush both should fire
    const crawlCalls = updateProgressFn.mock.calls.filter(
      ([, input]) => 'totalUrlsCrawled' in input
    )
    expect(crawlCalls.length).toBeGreaterThanOrEqual(2)
    expect(result.failed).toHaveLength(1)
    expect(result.successful).toHaveLength(9)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8: Non-Error throw paths in crawlAndClassifyPages
// ─────────────────────────────────────────────────────────────────────────────

describe('crawlAndClassifyPages — non-Error throw in upsert (Suite 8)', () => {
  afterEach(() => vi.clearAllMocks())

  it('handles upsert throwing a non-Error value and adds it to failed', async () => {
    const url = 'https://example.com/'

    // Upsert throws a plain string instead of an Error object
    const throwingUpsert = vi.fn().mockRejectedValue('plain string failure')
    const supabase = {
      from: vi.fn().mockReturnValue({ upsert: throwingUpsert }),
    } as unknown as SupabaseClient

    vi.mocked(JobRunner).mockImplementation(
      () =>
        ({
          updateProgress: vi.fn().mockResolvedValue({}),
        } as never)
    )
    vi.mocked(crawlPages).mockResolvedValue([makeCrawlResult(url)])
    vi.mocked(classifyPage).mockResolvedValue(makeClassification())
    vi.mocked(detectGEOBlock).mockReturnValue(makeGeoResult())

    const result = await crawlAndClassifyPages(
      supabase,
      'client-abc',
      [url],
      'job-123',
      { maxPages: 100, rateLimitMs: 0 }
    )

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].error).toBe('plain string failure')
    expect(result.successful).toHaveLength(0)
  })
})
