import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockRun = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ads/prescription-launch-check-store', () => ({
  runPrescriptionLaunchCheck: mockRun,
}))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish: vi.fn(async () => undefined) })),
}))

function request(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers.authorization = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/prescription-launch-check', {
    method: 'GET',
    headers,
  })
}

describe('GET /api/cron/prescription-launch-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    mockRun.mockResolvedValue({
      partial: false,
      launches: 0,
      prescriptions_checked: 0,
      outcomes_written: 0,
      outcomes_skipped: 0,
      unsaved: 0,
      failed: 0,
    })
  })

  it('returns 401 without the bearer secret', async () => {
    const { GET } = await import('./route')
    const res = await GET(request(null))
    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns 500 when the secret is not configured', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('./route')
    const res = await GET(request('test-cron-secret'))
    expect(res.status).toBe(500)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns the receipt and does not call a model', async () => {
    const { GET } = await import('./route')
    const res = await GET(request('test-cron-secret'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.outcomes_written).toBe(0)
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
})
