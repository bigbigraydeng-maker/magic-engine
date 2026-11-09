import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/prescription-chain/load', () => ({
  serviceReader: (db: unknown) => db,
  loadChainFacts: vi.fn(),
}))

import { requirePaidClientAccess, type ClientAccessResult } from '@/lib/auth/client-access'
import { loadChainFacts } from '@/lib/prescription-chain/load'
import { GET } from './route'

const params = { id: 'client-1', pId: 'rx-1' }

function call(): Promise<Response> {
  return GET(new NextRequest('http://test/api/clients/client-1/prescription/rx-1/chain'), { params })
}

describe('GET prescription chain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the paid-client gate and does not widen it', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'forbidden',
    })
    const res = await call()
    expect(res.status).toBe(403)
    expect(loadChainFacts).not.toHaveBeenCalled()
  })

  it('returns 404 when the prescription row is absent', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: 'fde@example.com' },
      role: 'admin',
      tier: 'admin',
      allowedClientId: null,
    } as ClientAccessResult)
    vi.mocked(loadChainFacts).mockResolvedValue({
      nowIso: '2026-10-26T12:00:00.000Z',
      prescriptionId: 'rx-1',
      prescription: { read: 'ok', value: null },
      goal: { read: 'skipped' },
      outcome: { read: 'ok', value: null },
      strategy: { read: 'ok', value: null },
      plans: { read: 'ok', value: [] },
      workOrders: { read: 'skipped' },
      drafts: { read: 'ok', value: [] },
      snapshot: { read: 'unread' },
    })
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('returns the derived steps without writing', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: 'fde@example.com' },
      role: 'admin',
      tier: 'paid_client',
      allowedClientId: 'client-1',
    } as ClientAccessResult)
    vi.mocked(loadChainFacts).mockResolvedValue({
      nowIso: '2026-10-26T12:00:00.000Z',
      prescriptionId: 'rx-1',
      prescription: { read: 'unread' },
      goal: { read: 'skipped' },
      outcome: { read: 'unread' },
      strategy: { read: 'unread' },
      plans: { read: 'unread' },
      workOrders: { read: 'skipped' },
      drafts: { read: 'unread' },
      snapshot: { read: 'unread' },
    })
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json() as { chain: { steps: { state: string; detail: string }[] } }
    expect(body.chain.steps).toHaveLength(9)
    expect(body.chain.steps.every((item) => item.state === 'unread' && item.detail === '读不到')).toBe(true)
  })
})
