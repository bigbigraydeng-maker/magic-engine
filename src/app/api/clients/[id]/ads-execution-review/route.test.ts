import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  loadAdsExecutionReviewPanel: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))

vi.mock('@/lib/ads-execution-review/load', () => ({
  loadAdsExecutionReviewPanel: mocks.loadAdsExecutionReviewPanel,
}))

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function access(role: 'admin' | 'client-viewer', allowedClientId: string | null) {
  return {
    ok: true as const,
    role,
    allowedClientId,
    user: { email: 'fde@magicengine.cloud' },
  }
}

describe('GET /ads-execution-review', () => {
  beforeEach(() => {
    mocks.requirePaidClientAccess.mockReset()
    mocks.loadAdsExecutionReviewPanel.mockReset()
  })

  it('returns the panel for an authorized caller', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue(access('admin', null))
    mocks.loadAdsExecutionReviewPanel.mockResolvedValue({
      client_id: CLIENT,
      limit: 12,
      generated_at: '2026-02-01T00:00:00.000Z',
      items: [],
    })
    const { GET } = await import('./route')
    const res = await GET(new Request(`http://localhost/api/clients/${CLIENT}/ads-execution-review`), { params: { id: CLIENT } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.panel.client_id).toBe(CLIENT)
    expect(mocks.loadAdsExecutionReviewPanel).toHaveBeenCalledOnce()
  })

  it('refuses a viewer without access', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({ ok: false, status: 403 })
    const { GET } = await import('./route')
    const res = await GET(new Request(`http://localhost/api/clients/${CLIENT}/ads-execution-review`), { params: { id: CLIENT } })
    expect(res.status).toBe(403)
  })
})
