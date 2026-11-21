import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'

vi.mock('@/lib/ads/decision-log/lookback-job', () => ({
  runAdsDecisionLookbackJob: vi.fn(async () => ({
    clients: 0,
    due: 0,
    reviewed: 0,
    skipped: 0,
    failed: 0,
  })),
}))

vi.mock('@/lib/ads/decision-log/switch', () => ({
  listClientsWithDecisionReviewOn: vi.fn(async () => []),
}))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({
    finish: vi.fn(async () => undefined),
  })),
}))

describe('GET /api/cron/ads-decision-lookback', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'unit-test-secret'
  })

  it('dry_run returns success with cron auth', async () => {
    const req = new NextRequest('http://localhost/api/cron/ads-decision-lookback?dry_run=1', {
      headers: { authorization: 'Bearer unit-test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.dry_run).toBe(true)
  })
})
