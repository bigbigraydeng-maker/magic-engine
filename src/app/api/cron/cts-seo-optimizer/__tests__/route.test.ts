import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const finish = vi.fn()
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: vi.fn(async () => ({ finish })) }))
const runCtsMetaPr = vi.fn()
vi.mock('@/lib/seo-meta/cts-meta-pr', () => ({ runCtsMetaPr }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
})

describe('POST /api/cron/cts-seo-optimizer (retired)', () => {
  it('refuses with 410, records a failed run, and never runs the old optimiser', async () => {
    const { POST } = await import('../route')
    const res = await POST(new NextRequest('http://localhost/api/cron/cts-seo-optimizer', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }))
    expect(res.status).toBe(410)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }))
    expect(runCtsMetaPr).not.toHaveBeenCalled()
  })

  it('still rejects unauthenticated calls without logging a run', async () => {
    const { POST } = await import('../route')
    const res = await POST(new NextRequest('http://localhost/api/cron/cts-seo-optimizer', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(finish).not.toHaveBeenCalled()
  })
})
