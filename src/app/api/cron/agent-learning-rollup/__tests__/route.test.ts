/**
 * Integration tests for the agent-learning-rollup cron route.
 *
 * We mock the lib function (already unit-tested separately) and verify the
 * route's auth contract + happy-path JSON shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/memory/learning-rollup', () => ({
  runWeeklyLearningRollup: vi.fn(),
}))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(() => Promise.resolve({ finish: vi.fn().mockResolvedValue(undefined) })),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {},
}))

import { POST, GET } from '../route'
import { runWeeklyLearningRollup } from '@/lib/memory/learning-rollup'

const mockRollup = vi.mocked(runWeeklyLearningRollup)

function makeReq(method: 'POST' | 'GET', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/agent-learning-rollup', {
    method,
    headers,
  })
}

describe('POST /api/cron/agent-learning-rollup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 500 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeReq('POST', { authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET/)
    expect(mockRollup).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(makeReq('POST'))
    expect(res.status).toBe(401)
    expect(mockRollup).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is wrong', async () => {
    const res = await POST(makeReq('POST', { authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(mockRollup).not.toHaveBeenCalled()
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('runs rollup with default options and returns the result', async () => {
    mockRollup.mockResolvedValue({
      iso_week: '2026-W23',
      window_start: '2026-06-01T00:00:00.000Z',
      window_end: '2026-06-08T00:00:00.000Z',
      clients_processed: 3,
      preferences_inserted: 2,
      errors: 0,
      results: [],
    })

    const res = await POST(makeReq('POST', { authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.iso_week).toBe('2026-W23')
    expect(body.clients_processed).toBe(3)
    expect(body.preferences_inserted).toBe(2)
    expect(body.timestamp).toBeDefined()
    expect(mockRollup).toHaveBeenCalledTimes(1)
  })

  it('surfaces errors counts when some clients failed', async () => {
    mockRollup.mockResolvedValue({
      iso_week: '2026-W23',
      window_start: '2026-06-01T00:00:00.000Z',
      window_end: '2026-06-08T00:00:00.000Z',
      clients_processed: 5,
      preferences_inserted: 3,
      errors: 2,
      results: [],
    })

    const res = await POST(makeReq('POST', { authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.errors).toBe(2)
    expect(body.clients_processed).toBe(5)
  })

  it('returns 500 with the error message when the rollup throws', async () => {
    mockRollup.mockRejectedValue(new Error('database unreachable'))

    const res = await POST(makeReq('POST', { authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('database unreachable')
  })
})

describe('GET /api/cron/agent-learning-rollup', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('GET'))
    expect(res.status).toBe(401)
  })

  it('returns healthy ping with auth', async () => {
    const res = await GET(makeReq('GET', { authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.message).toMatch(/healthy/i)
  })
})
