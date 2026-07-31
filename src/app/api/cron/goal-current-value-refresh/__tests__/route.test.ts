import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/strategy/auto-fetch', () => ({
  autoFetchMetricValue: vi.fn(),
}))

// startCronRun writes to cron_run_logs via supabaseAdmin — out of scope here
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish: vi.fn(async () => {}) })),
}))

import { GET } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { autoFetchMetricValue } from '@/lib/strategy/auto-fetch'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret-123'
})

function makeReq(authHeader?: string) {
  const headers = new Headers()
  if (authHeader) headers.set('authorization', authHeader)
  return new NextRequest('http://localhost/api/cron/goal-current-value-refresh', {
    headers,
  })
}

describe('GET /api/cron/goal-current-value-refresh', () => {
  it('returns 401 without bearer token', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong bearer token', async () => {
    const res = await GET(makeReq('Bearer wrong'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET env not set', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeReq('Bearer anything'))
    expect(res.status).toBe(500)
  })

  it('returns 200 with 0 active goals (empty path)', async () => {
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    })
    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ processed: 0, succeeded: 0, failed: 0 })
  })

  it('continues processing when one goal autoFetch throws (partial failure)', async () => {
    const goals = [
      { id: 'g1', client_id: 'c1', primary_metric_key: 'organic_traffic' },
      { id: 'g2', client_id: 'c2', primary_metric_key: 'ai_visibility_score' },
    ]
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'goals') {
        // First call: select + eq returns goals; subsequent calls: update + eq returns ok
        return {
          select: () => ({ eq: () => Promise.resolve({ data: goals, error: null }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      if (table === 'clients') {
        // 真客户闸门：两个客户都是 active
        return {
          select: () => ({
            in: () => ({
              eq: () => Promise.resolve({ data: [{ id: 'c1' }, { id: 'c2' }], error: null }),
            }),
          }),
        }
      }
      return {} as any
    })

    ;(autoFetchMetricValue as any)
      .mockResolvedValueOnce({ ok: true, value: 1234, source: 'GA4', snapshot_date: '2026-06-04', label: '1234 sessions' })
      .mockRejectedValueOnce(new Error('boom'))

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(2)
    expect(body.succeeded).toBe(1)
    expect(body.failed).toBe(1)
  })

  it('records failed when autoFetch returns ok:false', async () => {
    const goals = [
      { id: 'g1', client_id: 'c1', primary_metric_key: 'ai_visibility_score' },
    ]
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            in: () => ({
              eq: () => Promise.resolve({ data: [{ id: 'c1' }], error: null }),
            }),
          }),
        }
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: goals, error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    })

    ;(autoFetchMetricValue as any).mockResolvedValueOnce({
      ok: false,
      reason: 'no AI visibility snapshots yet',
    })

    const res = await GET(makeReq('Bearer test-secret-123'))
    const body = await res.json()
    expect(body.failed).toBe(1)
    expect(body.succeeded).toBe(0)
  })
})
