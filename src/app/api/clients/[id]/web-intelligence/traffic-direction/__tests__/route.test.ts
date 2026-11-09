import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ access: vi.fn(), allowed: vi.fn(), competitors: vi.fn(), collect: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: mocks.access }))
vi.mock('@/lib/web-intelligence/contracts', () => ({ allowedClient: mocks.allowed }))
vi.mock('@/lib/web-intelligence/targets', () => ({ loadCompetitors: mocks.competitors }))
vi.mock('@/lib/web-intelligence/external-run', () => ({ collectAndRecordTrafficDirectionObservations: mocks.collect }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.client } }))

import { POST } from '../route'

describe('manual traffic direction route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('collects only active competitor domains and returns the audit receipt', async () => {
    mocks.access.mockResolvedValue({ ok: true, role: 'admin' }); mocks.allowed.mockReturnValue(true)
    mocks.competitors.mockResolvedValue([{ domain: 'wendywutours.co.nz', status: 'active' }, { domain: 'old.example', status: 'archive' }])
    mocks.client.mockReturnValue({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { domain: 'ctstours.co.nz' }, error: null }) }) }) })
    mocks.collect.mockResolvedValue({ persisted: 1, duplicates: 0, rejected: 0, runId: 'run-1', datasetId: 'dataset-1', costUsd: 0.01 })
    const response = await POST(new Request('http://localhost'), { params: Promise.resolve({ id: 'client-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-1', domains: ['ctstours.co.nz', 'wendywutours.co.nz'], maxChargeUsd: 0.15 }))
    await expect(response.json()).resolves.toMatchObject({ persisted: 1, run_id: 'run-1', dataset_id: 'dataset-1', cost_usd: 0.01 })
  })

  it('does not start collection for a client outside the rollout', async () => {
    mocks.access.mockResolvedValue({ ok: true, role: 'admin' }); mocks.allowed.mockReturnValue(false)
    const response = await POST(new Request('http://localhost'), { params: Promise.resolve({ id: 'client-2' }) })
    expect(response.status).toBe(403); expect(mocks.collect).not.toHaveBeenCalled()
  })
})
