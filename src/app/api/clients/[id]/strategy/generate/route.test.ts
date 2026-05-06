/**
 * Tests for POST /api/clients/[id]/strategy/generate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/strategy/orchestrator', () => ({
  runStrategyAnalysis: vi.fn(),
}))

import { POST } from './route'
import { runStrategyAnalysis } from '@/lib/strategy/orchestrator'

const CLIENT_ID = 'client-1'
const req = () =>
  new NextRequest('http://localhost/api/clients/x/strategy/generate', {
    method: 'POST',
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/clients/[id]/strategy/generate', () => {
  it('runs and returns summary', async () => {
    vi.mocked(runStrategyAnalysis).mockResolvedValue({
      client_id: CLIENT_ID,
      strategy_run_id: 'run-1',
      candidates_generated: 5,
      upgrade_pages: 1,
      new_blogs: 4,
      social_content: 0,
      unified_count: 2,
      geo_only_count: 2,
      seo_only_count: 1,
      ran_at: 'now',
    })

    const res = await POST(req(), { params: { id: CLIENT_ID } })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.summary.candidates_generated).toBe(5)
    expect(runStrategyAnalysis).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('returns 500 on failure', async () => {
    vi.mocked(runStrategyAnalysis).mockRejectedValue(new Error('analyzer down'))
    const res = await POST(req(), { params: { id: CLIENT_ID } })
    expect(res.status).toBe(500)
    const j = await res.json()
    expect(j.error).toMatch(/analyzer down/)
  })
})
