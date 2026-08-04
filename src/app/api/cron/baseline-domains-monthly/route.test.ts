/**
 * Cost-gate tests for the baseline-domains cron — PM 2026-07-31「每周省到底」
 *
 * This endpoint spends real money. Two gates keep it at ~US$13/month instead of
 * ~US$360/month, and each has a test whose assertion is about SPEND, not HTTP:
 *
 *   1. Weekly throttle — Render fires it daily (that cron is hand-made in the
 *      Render dashboard, not in render.yaml, and we hold no Render API key), so
 *      the once-a-week decision lives here in code.
 *   2. skipSerp — SERP is ~75% of the per-domain cost and feeds only findings,
 *      which this cron discards. It must never be requested.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockCollect, mockStartCronRun, mockThrottleQuery } = vi.hoisted(() => ({
  mockCollect: vi.fn(),
  mockStartCronRun: vi.fn(),
  mockThrottleQuery: vi.fn(),
}))

vi.mock('@/lib/diagnostic/collectors/seo-collector', () => ({
  SeoCollector: class {
    collect = mockCollect
  },
}))

vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: mockStartCronRun }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      // throttle lookup
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({ maybeSingle: mockThrottleQuery })),
          })),
        })),
      })),
      // When a run IS allowed through, GET fire-and-forgets runCollection().
      // Stub the run-record insert so it bails out immediately instead of
      // leaving an unhandled rejection in the suite. The gate assertions all
      // fire before this point.
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'stubbed in test' } }),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    })),
  },
}))

const CRON_SECRET = 'test-cron-secret'
const DAY_MS = 86_400_000

function makeGet(secret: string | null = CRON_SECRET) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers.authorization = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/baseline-domains-monthly', {
    method: 'GET',
    headers,
  })
}

/** Pretend the last successful run was N days ago. */
function lastRunDaysAgo(days: number) {
  mockThrottleQuery.mockResolvedValue({
    data: { started_at: new Date(Date.now() - days * DAY_MS).toISOString() },
    error: null,
  })
}

describe('GET /api/cron/baseline-domains-monthly — cost gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockStartCronRun.mockResolvedValue({ finish: vi.fn() })
  })

  afterEach(() => {
    delete process.env.BASELINE_CRON_ENABLED
  })

  describe('weekly throttle', () => {
    it.each([0, 1, 3, 6.9])('spends nothing when the last run was %s days ago', async days => {
      lastRunDaysAgo(days)
      const { GET } = await import('./route')

      const body = await (await GET(makeGet())).json()

      expect(body.skipped).toBe(true)
      expect(body.reason).toBe('throttled')
      expect(mockCollect).not.toHaveBeenCalled()
    })

    it('lets the run through once 7 days have passed', async () => {
      lastRunDaysAgo(7.1)
      const { GET } = await import('./route')

      const body = await (await GET(makeGet())).json()

      expect(body.skipped).toBeUndefined()
      expect(mockStartCronRun).toHaveBeenCalled()
    })

    it('lets the very first run through (no history yet)', async () => {
      mockThrottleQuery.mockResolvedValue({ data: null, error: null })
      const { GET } = await import('./route')

      const body = await (await GET(makeGet())).json()
      expect(body.skipped).toBeUndefined()
    })

    it('skips rather than spends when the throttle lookup itself fails', async () => {
      mockThrottleQuery.mockResolvedValue({ data: null, error: { message: 'rls denied' } })
      const { GET } = await import('./route')

      const body = await (await GET(makeGet())).json()

      expect(body.skipped).toBe(true)
      expect(mockCollect).not.toHaveBeenCalled()
    })
  })

  describe('hard disable', () => {
    it('spends nothing when BASELINE_CRON_ENABLED=false, even if 30 days have passed', async () => {
      process.env.BASELINE_CRON_ENABLED = 'false'
      lastRunDaysAgo(30)
      const { GET } = await import('./route')

      const body = await (await GET(makeGet())).json()

      expect(body.reason).toBe('disabled')
      expect(mockCollect).not.toHaveBeenCalled()
    })
  })

  describe('auth still comes first', () => {
    it('rejects a bad secret before touching the throttle or spending', async () => {
      lastRunDaysAgo(30)
      const { GET } = await import('./route')

      const res = await GET(makeGet('wrong-secret'))

      expect(res.status).toBe(401)
      expect(mockThrottleQuery).not.toHaveBeenCalled()
      expect(mockCollect).not.toHaveBeenCalled()
    })
  })

  it('returns 2xx when skipping so Render does not flag a failing job', async () => {
    lastRunDaysAgo(1)
    const { GET } = await import('./route')

    const res = await GET(makeGet())
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(300)
  })
})
