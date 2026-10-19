import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  pullMetrics: vi.fn(),
  syncPageMetrics: vi.fn(),
  finish: vi.fn(),
  clients: [{ id: 'c1' }, { id: 'c2' }] as Array<{ id: string }>,
}))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.not = vi.fn().mockImplementation(() => Promise.resolve({ data: mocks.clients, error: null }))
  return { supabaseAdmin: { from: vi.fn().mockReturnValue(chain) } }
})

vi.mock('@/lib/social/page-metrics-sync', () => ({ syncPageMetrics: mocks.syncPageMetrics }))

vi.mock('@/lib/flywheel/adapters/TikTokAdapter', () => ({
  TikTokAdapter: class {
    pullMetrics = mocks.pullMetrics
  },
}))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn().mockResolvedValue({ finish: mocks.finish }),
}))

import { GET } from '../route'

function req(auth = 'Bearer test-secret') {
  return new NextRequest('http://localhost:3001/api/cron/social-engagement-pullback', {
    headers: { Authorization: auth },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
  mocks.pullMetrics.mockResolvedValue([{ metric: 'followers' }])
  mocks.syncPageMetrics.mockResolvedValue({ pages: 2, metrics_written: 6 })
})

describe('GET /api/cron/social-engagement-pullback', () => {
  it('rejects a missing/incorrect bearer token', async () => {
    const res = await GET(req('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(mocks.pullMetrics).not.toHaveBeenCalled()
  })

  it('runs the TikTok and Facebook page-metric legs and returns no Publer fields', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>

    expect(mocks.pullMetrics).toHaveBeenCalledTimes(2)
    expect(mocks.syncPageMetrics).toHaveBeenCalledTimes(1)
    expect(body.tiktok).toEqual({ clients_processed: 2, tiktok_synced: 2, failed: 0 })
    expect(body.page_metrics).toEqual({ pages: 2, metrics_written: 6 })
    // Former Publer engagement fields must be gone from the response.
    expect(body).not.toHaveProperty('total_posts')
    expect(body).not.toHaveProperty('updated')
    expect(JSON.stringify(body).toLowerCase()).not.toContain('publer')
    expect(JSON.stringify(mocks.finish.mock.calls).toLowerCase()).not.toContain('publer')
  })

  it('a failing page-metrics leg is reported but does not fail the cron', async () => {
    mocks.syncPageMetrics.mockRejectedValue(new Error('boom'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json() as { page_metrics: unknown }
    expect(body.page_metrics).toEqual({ error: 'boom' })
    expect(mocks.pullMetrics).toHaveBeenCalledTimes(2)
  })
})
