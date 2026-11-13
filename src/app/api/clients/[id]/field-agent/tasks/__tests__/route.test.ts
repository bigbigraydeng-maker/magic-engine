import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ access: vi.fn(), competitors: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: mocks.access }))
vi.mock('@/lib/web-intelligence/targets', () => ({ loadCompetitors: mocks.competitors }))
vi.mock('@/lib/field-agent/tasks', () => ({ createCompetitorAdsTask: mocks.create }))

import { DASHBOARD_COMPETITOR_ADS_REQUEST } from '@/lib/field-agent/contracts'
import { POST } from '../route'

const ctx = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }

describe('field agent task route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a non-admin before creating a task', async () => {
    mocks.access.mockResolvedValue({ ok: true, role: 'client-viewer', user: { email: 'viewer@example.com' } })
    const response = await POST(new Request('http://localhost', { method: 'POST', body: '{}' }), ctx)
    expect(response.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('passes the dashboard payload and the signed-in email to the dispatcher', async () => {
    mocks.access.mockResolvedValue({ ok: true, role: 'admin', user: { email: 'ray@example.com' } })
    mocks.competitors.mockResolvedValue([])
    mocks.create.mockResolvedValue({ httpStatus: 200, ok: false, dispatched: false, task_id: null, status: null, message: '外勤采集还没接上' })
    const response = await POST(new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DASHBOARD_COMPETITOR_ADS_REQUEST),
    }), ctx)
    expect(response.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      clientId: '11111111-1111-4111-8111-111111111111',
      requestedByEmail: 'ray@example.com',
      body: DASHBOARD_COMPETITOR_ADS_REQUEST,
    }))
  })
})
