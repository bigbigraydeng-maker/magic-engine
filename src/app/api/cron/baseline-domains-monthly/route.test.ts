/**
 * Kill-switch tests for the baseline-domains cron — PM 2026-07-31「停批量」
 *
 * This endpoint spends real money: every run scores 61 competitor domains via
 * DataForSEO (SERP depth=100 × 10 keywords + Labs + Backlinks ≈ US$12/run).
 * The assertion that matters is not the HTTP status — it is that
 * SeoCollector.collect is NEVER reached while the switch is off.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockCollect, mockStartCronRun } = vi.hoisted(() => ({
  mockCollect: vi.fn(),
  mockStartCronRun: vi.fn(),
}))

vi.mock('@/lib/diagnostic/collectors/seo-collector', () => ({
  SeoCollector: class {
    collect = mockCollect
  },
}))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: mockStartCronRun,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

const CRON_SECRET = 'test-cron-secret'

function makeGet(secret: string | null = CRON_SECRET) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers.authorization = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/baseline-domains-monthly', {
    method: 'GET',
    headers,
  })
}

describe('GET /api/cron/baseline-domains-monthly — spend kill switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockStartCronRun.mockResolvedValue({ finish: vi.fn() })
  })

  afterEach(() => {
    delete process.env.BASELINE_CRON_ENABLED
  })

  it('spends nothing when BASELINE_CRON_ENABLED is unset', async () => {
    delete process.env.BASELINE_CRON_ENABLED
    const { GET } = await import('./route')

    const res = await GET(makeGet())
    const body = await res.json()

    expect(body.skipped).toBe(true)
    // The money assertion: the collector was never even constructed-and-called.
    expect(mockCollect).not.toHaveBeenCalled()
    expect(mockStartCronRun).not.toHaveBeenCalled()
  })

  it.each(['false', 'TRUE', '1', 'yes', ''])(
    'stays paused for BASELINE_CRON_ENABLED=%j (only exact "true" resumes)',
    async value => {
      process.env.BASELINE_CRON_ENABLED = value
      const { GET } = await import('./route')

      const res = await GET(makeGet())
      const body = await res.json()

      expect(body.skipped).toBe(true)
      expect(mockCollect).not.toHaveBeenCalled()
    },
  )

  it('returns 2xx so the Render cron does not flap as a failing job', async () => {
    delete process.env.BASELINE_CRON_ENABLED
    const { GET } = await import('./route')

    const res = await GET(makeGet())
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(300)
  })

  it('still rejects an unauthorised caller before anything else', async () => {
    delete process.env.BASELINE_CRON_ENABLED
    const { GET } = await import('./route')

    const res = await GET(makeGet('wrong-secret'))
    expect(res.status).toBe(401)
    expect(mockCollect).not.toHaveBeenCalled()
  })
})
