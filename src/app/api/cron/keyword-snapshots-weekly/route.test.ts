/**
 * Tests for keyword-snapshots-weekly cron endpoint — P12.I.8
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockClientsQuery, mockEq, mockSnapshotRankedKeywordsForClient } = vi.hoisted(() => ({
  mockClientsQuery: vi.fn(),
  mockEq: vi.fn(),
  mockSnapshotRankedKeywordsForClient: vi.fn(),
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
    })
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
