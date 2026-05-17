import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

vi.mock('@/lib/flywheel/attribution/job', () => ({
  runAttributionJob: vi.fn(),
}))

import { runAttributionJob } from '@/lib/flywheel/attribution/job'

const mockRunAttributionJob = vi.mocked(runAttributionJob)

function makeRequest(
  headers: Record<string, string> = {},
  search = ''
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/cron/attribution${search}`,
    { method: 'POST', headers }
  )
}

describe('POST /api/cron/attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET/)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when Authorization header is wrong', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('calls runAttributionJob with default options and returns result', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 5, written: 3, skipped: 2 })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.processed).toBe(5)
    expect(body.written).toBe(3)
    expect(body.skipped).toBe(2)
    expect(body.timestamp).toBeDefined()

    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: undefined,
      clientId: undefined,
    })
  })

  it('passes window_days query param to runAttributionJob', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 2, written: 2, skipped: 0 })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?window_days=30')
    )
    expect(res.status).toBe(200)
    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: 30,
      clientId: undefined,
    })
  })

  it('passes client_id query param to runAttributionJob', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 1, skipped: 0 })

    const res = await POST(
      makeRequest(
        { authorization: 'Bearer test-secret' },
        '?client_id=abc-123'
      )
    )
    expect(res.status).toBe(200)
    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: undefined,
      clientId: 'abc-123',
    })
  })

  // ── Error handling ──────────────────────────────────────────────────────────

  it('returns 500 when runAttributionJob throws', async () => {
    mockRunAttributionJob.mockRejectedValue(new Error('DB connection failed'))

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('DB connection failed')
  })
})
