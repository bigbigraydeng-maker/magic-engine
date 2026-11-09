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

// startCronRun writes to cron_run_logs via supabaseAdmin — replaced by a spy so
// tests can assert what lands in the run log.
const finishMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish: finishMock })),
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

  it('same client with 2 active goals → each refreshed with its own period', async () => {
    const goals = [
      { id: 'g-signups', client_id: 'c1', primary_metric_key: 'signups_count', period_start: '2026-09-24', period_end: '2026-11-30' },
      { id: 'g-leads', client_id: 'c1', primary_metric_key: 'leads_count', period_start: '2026-10-01', period_end: '2026-12-31' },
    ]
    const updatedIds: string[] = []
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [{ id: 'c1' }], error: null }) }) }),
        }
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: goals, error: null }) }),
        update: () => ({
          eq: (_col: string, id: string) => {
            updatedIds.push(id)
            return Promise.resolve({ error: null })
          },
        }),
      }
    })
    ;(autoFetchMetricValue as any).mockImplementation(async (_db: unknown, _c: string, key: string) =>
      ({ ok: true, value: key === 'leads_count' ? 23 : 2, source: 'x', snapshot_date: '2026-09-26', label: key }))

    const res = await GET(makeReq('Bearer test-secret-123'))
    const body = await res.json()

    expect(body).toMatchObject({ processed: 2, succeeded: 2, failed: 0 })
    expect(updatedIds.sort()).toEqual(['g-leads', 'g-signups'])
    expect(autoFetchMetricValue).toHaveBeenCalledWith(expect.anything(), 'c1', 'signups_count', {
      goalPeriod: { period_start: '2026-09-24', period_end: '2026-11-30' },
    })
    expect(autoFetchMetricValue).toHaveBeenCalledWith(expect.anything(), 'c1', 'leads_count', {
      goalPeriod: { period_start: '2026-10-01', period_end: '2026-12-31' },
    })
    expect(finishMock).toHaveBeenCalledWith(expect.objectContaining({ processed: 2, completed: 2, failed: 0, error: undefined }))
  })

  it('real failures are written to the run log (error + summary); "no records yet" is logged but not a failure', async () => {
    const goals = [
      { id: 'g1', client_id: 'c1', primary_metric_key: 'signups_count', period_start: '2026-09-24', period_end: '2026-11-30' },
      { id: 'g2', client_id: 'c1', primary_metric_key: 'leads_count', period_start: '2026-09-24', period_end: '2026-11-30' },
    ]
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [{ id: 'c1' }], error: null }) }) }),
        }
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: goals, error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    })
    ;(autoFetchMetricValue as any)
      .mockResolvedValueOnce({ ok: false, unknown: true, noData: true, reason: 'no bookings yet' })
      // unknown WITHOUT noData (ambiguous goal / query error) is still a fault
      .mockResolvedValueOnce({ ok: false, unknown: true, reason: 'client has several active goals' })

    const res = await GET(makeReq('Bearer test-secret-123'))
    const body = await res.json()

    expect(body).toMatchObject({ processed: 2, succeeded: 0, failed: 1 })
    expect(finishMock).toHaveBeenCalledTimes(1)
    type Entry = { goal_id: string; reason: string }
    const [arg] = finishMock.mock.calls[0] as unknown as [
      { failed: number; error?: string; summary?: { errors: Entry[]; no_data: Entry[] } },
    ]
    expect(arg.failed).toBe(1)
    expect(arg.error).toBe('goal g2: client has several active goals')
    expect(arg.summary?.errors).toEqual([{ goal_id: 'g2', reason: 'client has several active goals' }])
    expect(arg.summary?.no_data).toEqual([{ goal_id: 'g1', reason: 'no bookings yet' }])
  })

  it('only "no records yet" → run is not failed (no error), but the reason is kept in summary', async () => {
    const goals = [
      { id: 'g1', client_id: 'c1', primary_metric_key: 'signups_count', period_start: '2026-09-24', period_end: '2026-11-30' },
    ]
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [{ id: 'c1' }], error: null }) }) }),
        }
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: goals, error: null }) }) }
    })
    ;(autoFetchMetricValue as any).mockResolvedValueOnce({ ok: false, unknown: true, noData: true, reason: 'no bookings yet' })

    await GET(makeReq('Bearer test-secret-123'))

    expect(finishMock).toHaveBeenCalledWith(expect.objectContaining({
      failed: 0,
      error: undefined,
      summary: { errors: [], no_data: [{ goal_id: 'g1', reason: 'no bookings yet' }] },
    }))
  })

  it('goals query error → 500 and a failed run with the reason (not "0 goals, clean")', async () => {
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'db down' } }) }),
    })

    const res = await GET(makeReq('Bearer test-secret-123'))

    expect(res.status).toBe(500)
    expect(finishMock).toHaveBeenCalledWith({ failed: 1, error: 'Failed to load active goals: db down' })
  })

  it('signups goal with a departure list asks for deposited seats', async () => {
    const goals = [{
      id: 'g-signups',
      client_id: 'c1',
      primary_metric_key: 'signups_count',
      period_start: '2026-10-21',
      period_end: '2027-02-28',
      created_at: '2026-10-16T01:00:00.000Z',
      baseline_value: 0,
      supporting_metrics: [{
        key: 'deposited_seat_scope',
        label: '已收定金座位',
        departures: [{ depart_on: '2027-03-18', tour_id: 'tour-b' }],
      }],
    }]
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [{ id: 'c1' }], error: null }) }) }),
        }
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: goals, error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    })
    ;(autoFetchMetricValue as any).mockResolvedValue({
      ok: true, value: 2, source: 'auto.crm_deposited_seats', snapshot_date: '2027-02-28', label: '1 笔定金，2 个座位',
    })

    const res = await GET(makeReq('Bearer test-secret-123'))

    expect(res.status).toBe(200)
    expect(autoFetchMetricValue).toHaveBeenCalledWith(expect.anything(), 'c1', 'signups_count', {
      goalPeriod: { period_start: '2026-10-21', period_end: '2027-02-28' },
      depositedSeatScope: [{ departOn: '2027-03-18', tourId: 'tour-b' }],
      goalCreatedAt: '2026-10-16T01:00:00.000Z',
      baselineValue: 0,
    })
  })
})
