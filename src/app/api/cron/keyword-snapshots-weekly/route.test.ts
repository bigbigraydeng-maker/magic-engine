/**
 * Tests for keyword-snapshots-weekly cron endpoint — P12.I.8
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockClientsQuery, mockEq, mockSnapshotRankedKeywordsForClient, mockCaptureSerpForClient, mockSnapshotWatched } = vi.hoisted(() => ({
  mockClientsQuery: vi.fn(),
  mockEq: vi.fn(),
  mockSnapshotRankedKeywordsForClient: vi.fn(),
  mockCaptureSerpForClient: vi.fn(),
  mockSnapshotWatched: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: mockEq.mockImplementation(() => ({
          not: mockClientsQuery,
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/seo-intelligence/keyword-snapshots', () => ({
  snapshotRankedKeywordsForClient: mockSnapshotRankedKeywordsForClient,
}))

vi.mock('@/lib/seo-intelligence/serp-capture', () => ({
  captureSerpForClient: mockCaptureSerpForClient,
}))

vi.mock('@/lib/seo-intelligence/watch-keywords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo-intelligence/watch-keywords')>()
  return { ...actual, snapshotWatchedKeywordsForClient: mockSnapshotWatched }
})

// startCronRun writes to cron_run_logs via supabaseAdmin — out of scope here
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish: vi.fn(async () => {}) })),
}))

function makeRequest(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers.authorization = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/keyword-snapshots-weekly', {
    method: 'GET',
    headers,
  })
}

const CRON_SECRET = 'test-cron-secret'

describe('GET /api/cron/keyword-snapshots-weekly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    // Step 2 (SERP capture) default: succeeds with nothing captured.
    mockCaptureSerpForClient.mockResolvedValue({
      client_id: 'x',
      domain: 'x',
      keywords_captured: 0,
      serp_rows_written: 0,
      local_pack_hits: 0,
      keywords_failed: 0,
    })
  })

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/CRON_SECRET/)
  })

  it('returns 401 when authorization header is missing', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest(null))

    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header has wrong secret', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeRequest('wrong-secret'))

    expect(res.status).toBe(401)
  })

  it('returns 500 when clients DB query fails', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/connection refused/)
  })

  it('returns early with 0 processed when no clients have a domain', async () => {
    mockClientsQuery.mockResolvedValueOnce({ data: [], error: null })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.clients_processed).toBe(0)
    expect(json.snapshots_written).toBe(0)
    expect(json.failed).toBe(0)
  })

  it('processes one client and returns snapshot counts', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [{ id: 'client-cts', domain: 'ctstours.com.au', semrush_db: 'au' }],
      error: null,
    })
    mockSnapshotRankedKeywordsForClient.mockResolvedValueOnce({
      client_id: 'client-cts',
      domain: 'ctstours.com.au',
      location_code: 2036,
      keywords_seen: 200,
      snapshots_written: 200,
    })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.clients_processed).toBe(1)
    expect(json.snapshots_written).toBe(200)
    expect(json.failed).toBe(0)
    // 真客户闸门：选客户必须按 client_status='active' 过滤
    expect(mockEq).toHaveBeenCalledWith('client_status', 'active')
    expect(mockSnapshotRankedKeywordsForClient).toHaveBeenCalledWith({
      id: 'client-cts',
      domain: 'ctstours.com.au',
      semrush_db: 'au',
      name: '',
      brand_aliases: null,
    })
  })

  it('runs the watch-keyword step only for clients whose seo_config lists watch keywords', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [
        { id: 'client-a', domain: 'a.co.nz', semrush_db: 'nz', seo_config: { rank_watch_keywords: [' Alpha Trip ', 'beta route'] } },
        { id: 'client-b', domain: 'b.co.nz', semrush_db: 'nz', seo_config: null },
      ],
      error: null,
    })
    mockSnapshotRankedKeywordsForClient.mockResolvedValue({
      client_id: 'x', domain: 'x', location_code: 2554, keywords_seen: 1, snapshots_written: 1,
    })
    mockSnapshotWatched.mockResolvedValueOnce({
      client_id: 'client-a', dry_run: false, keywords_requested: 2, skipped_already_snapshotted: [],
      readings: [], rows_written: 2, cost_usd: 0.031,
    })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(mockSnapshotWatched).toHaveBeenCalledTimes(1)
    expect(mockSnapshotWatched).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'client-a' }),
      ['alpha trip', 'beta route'],
    )
    expect(json.results[0].watch).toMatchObject({ rows_written: 2 })
    expect(json.results[1].watch).toBeUndefined()
  })

  it('clients without rank_watch_keywords keep the original path: no watch call, no watch fields', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [
        { id: 'client-none', domain: 'n.co.nz', semrush_db: 'nz' },
        { id: 'client-null', domain: 'm.co.nz', semrush_db: 'nz', seo_config: null },
        { id: 'client-empty', domain: 'e.co.nz', semrush_db: 'nz', seo_config: { rank_watch_keywords: [] } },
        { id: 'client-junk', domain: 'j.co.nz', semrush_db: 'nz', seo_config: { rank_watch_keywords: 'not-an-array' } },
      ],
      error: null,
    })
    mockSnapshotRankedKeywordsForClient.mockResolvedValue({
      client_id: 'x', domain: 'x', location_code: 2554, keywords_seen: 10, snapshots_written: 10,
    })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockSnapshotWatched).not.toHaveBeenCalled()
    expect(mockSnapshotRankedKeywordsForClient).toHaveBeenCalledTimes(4)
    expect(mockCaptureSerpForClient).toHaveBeenCalledTimes(4)
    expect(json.snapshots_written).toBe(40)
    expect(json.failed).toBe(0)
    for (const r of json.results) {
      expect(r).not.toHaveProperty('watch')
      expect(r).not.toHaveProperty('watch_error')
      expect(r).toHaveProperty('serp')
    }
  })

  it('a watch-keyword failure is recorded but does not undo or fail the main snapshot', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [{ id: 'client-a', domain: 'a.co.nz', semrush_db: 'nz', seo_config: { rank_watch_keywords: ['alpha trip'] } }],
      error: null,
    })
    mockSnapshotRankedKeywordsForClient.mockResolvedValueOnce({
      client_id: 'client-a', domain: 'a.co.nz', location_code: 2554, keywords_seen: 50, snapshots_written: 50,
    })
    mockSnapshotWatched.mockRejectedValueOnce(new Error('keyword_snapshots watch upsert failed: boom'))

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.failed).toBe(0)
    expect(json.snapshots_written).toBe(50)
    expect(json.results[0].watch_error).toMatch(/watch upsert failed/)
  })

  it('continues processing remaining clients when one snapshot fails', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [
        { id: 'client-bad', domain: 'bad.com.au', semrush_db: 'au' },
        { id: 'client-ok', domain: 'ok.co.nz', semrush_db: 'nz' },
      ],
      error: null,
    })
    mockSnapshotRankedKeywordsForClient
      .mockRejectedValueOnce(new Error('DataForSEO timeout'))
      .mockResolvedValueOnce({
        client_id: 'client-ok',
        domain: 'ok.co.nz',
        location_code: 2554,
        keywords_seen: 120,
        snapshots_written: 120,
      })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.clients_processed).toBe(2)
    expect(json.snapshots_written).toBe(120)
    expect(json.failed).toBe(1)
    expect(json.results[0]).toMatchObject({
      client_id: 'client-bad',
      snapshots_written: 0,
      error: 'DataForSEO timeout',
    })
    expect(json.results[1]).toMatchObject({
      client_id: 'client-ok',
      snapshots_written: 120,
    })
    // 步 2 只对步 1 成功的客户跑（防止把 SERP 步挪到 try 外的变异）
    expect(mockCaptureSerpForClient).toHaveBeenCalledTimes(1)
  })

  it('runs SERP capture (step 2) per client and reports its counts', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [{ id: 'client-cts', domain: 'ctstours.com.au', semrush_db: 'au', name: 'CTS', brand_aliases: [] }],
      error: null,
    })
    mockSnapshotRankedKeywordsForClient.mockResolvedValueOnce({
      client_id: 'client-cts',
      domain: 'ctstours.com.au',
      location_code: 2036,
      keywords_seen: 10,
      snapshots_written: 10,
    })
    mockCaptureSerpForClient.mockResolvedValueOnce({
      client_id: 'client-cts',
      domain: 'ctstours.com.au',
      keywords_captured: 10,
      serp_rows_written: 10,
      local_pack_hits: 3,
      keywords_failed: 0,
    })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(mockCaptureSerpForClient).toHaveBeenCalledTimes(1)
    expect(json.serp_rows_written).toBe(10)
    expect(json.serp_failed).toBe(0)
    expect(json.results[0].serp).toMatchObject({ local_pack_hits: 3 })
  })

  it('SERP capture failure does not fail the client (step 1 already landed)', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [{ id: 'client-cts', domain: 'ctstours.com.au', semrush_db: 'au', name: 'CTS', brand_aliases: [] }],
      error: null,
    })
    mockSnapshotRankedKeywordsForClient.mockResolvedValueOnce({
      client_id: 'client-cts',
      domain: 'ctstours.com.au',
      location_code: 2036,
      keywords_seen: 10,
      snapshots_written: 10,
    })
    mockCaptureSerpForClient.mockRejectedValueOnce(new Error('DataForSEO SERP error: 500'))

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.failed).toBe(0)
    expect(json.serp_failed).toBe(1)
    expect(json.snapshots_written).toBe(10)
    expect(json.results[0].serp_error).toMatch(/DataForSEO/)
  })

  it('filters out clients that have null or empty domain', async () => {
    mockClientsQuery.mockResolvedValueOnce({
      data: [
        { id: 'client-nodomain', domain: null, semrush_db: 'au' },
        { id: 'client-emptydomain', domain: '', semrush_db: 'au' },
        { id: 'client-valid', domain: 'valid.com.au', semrush_db: null },
      ],
      error: null,
    })
    mockSnapshotRankedKeywordsForClient.mockResolvedValueOnce({
      client_id: 'client-valid',
      domain: 'valid.com.au',
      location_code: 2036,
      keywords_seen: 10,
      snapshots_written: 10,
    })

    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    const json = await res.json()

    expect(json.clients_processed).toBe(1)
    expect(json.results[0].client_id).toBe('client-valid')
  })
})
