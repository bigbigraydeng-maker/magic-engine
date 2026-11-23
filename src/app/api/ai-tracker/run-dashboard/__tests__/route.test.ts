import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/ai-tracker/orchestrator', () => ({
  runTracker: vi.fn(),
}))

import { POST } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { runTracker } from '@/lib/ai-tracker/orchestrator'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const mockRequireDashboardClientAccess = vi.mocked(requireDashboardClientAccess)
const mockRunTracker = vi.mocked(runTracker)

function request(body: unknown) {
  return new NextRequest('http://localhost:3001/api/ai-tracker/run-dashboard', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/ai-tracker/run-dashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 before running when the Magic Link session is missing', async () => {
    mockRequireDashboardClientAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    })

    const res = await POST(request({ client_id: CLIENT_ID }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ success: false, error: 'Unauthorized' })
    expect(mockRunTracker).not.toHaveBeenCalled()
  })

  it('returns 403 before running when the session cannot access the client', async () => {
    mockRequireDashboardClientAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const res = await POST(request({ client_id: CLIENT_ID }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ success: false, error: 'Forbidden' })
    expect(mockRunTracker).not.toHaveBeenCalled()
  })

  it('starts the tracker in the background for an authorized dashboard session', async () => {
    mockRequireDashboardClientAccess.mockResolvedValue({
      ok: true,
      user: { id: 'user-1', email: 'pm@magiclab.com' },
      role: 'admin',
      allowedClientId: null,
    } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
    mockRunTracker.mockResolvedValue({
      client_id: CLIENT_ID,
      runs_attempted: 2,
      runs_succeeded: 2,
      runs_failed: 0,
      runs_conclusive: 2,
      client_brand_mentions: 1,
      total_cost_usd: 0.02,
      total_latency_ms: 1200,
      snapshot_id: 'snapshot-1',
      snapshot_skipped_reason: null,
      errors: [],
    })

    const res = await POST(request({ client_id: CLIENT_ID, engines: ['openai'] }))
    const body = await res.json()

    // Fire-and-forget: the response is an instant acknowledgement, not the
    // tracker result (Render keeps the promise running after the response).
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, status: 'started' })
    expect(mockRequireDashboardClientAccess).toHaveBeenCalledWith(CLIENT_ID)
    expect(mockRunTracker).toHaveBeenCalledWith({
      client_id: CLIENT_ID,
      query_ids: undefined,
      engines: ['openai'],
    })
  })
})
