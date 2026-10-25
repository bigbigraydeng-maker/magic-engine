import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  plans: [] as Record<string, unknown>[],
  planError: null as { message: string } | null,
  loadRx: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.access,
}))
vi.mock('@/lib/marketing-plan/promo/goal-prescription', () => ({
  loadLatestClientPrescription: mocks.loadRx,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.eq = self
      chain.order = self
      chain.limit = self
      chain.then = (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) =>
        Promise.resolve({ data: mocks.plans, error: mocks.planError }).then(resolve)
      return chain
    },
  },
}))

import { GET } from '../route'

function get() {
  return GET(
    new NextRequest('http://localhost/api/clients/client-1/marketing-plan'),
    { params: { id: 'client-1' } },
  )
}

beforeEach(() => {
  mocks.access.mockReset()
  mocks.access.mockResolvedValue({ ok: true, tier: 'paid_client' })
  mocks.plans = [{ id: 'plan-old', status: 'approved' }]
  mocks.planError = null
  mocks.loadRx.mockReset()
  mocks.loadRx.mockResolvedValue({ id: 'rx-1', goal_id: 'goal-9', todos: ['做成一件事'] })
})

describe('GET /marketing-plan 附上客户最近一份处方', () => {
  it('没有计划时也带回处方，方便页面直接显示', async () => {
    mocks.plans = []
    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.plans).toEqual([])
    expect(json.prescription).toMatchObject({ id: 'rx-1', goal_id: 'goal-9' })
    expect(mocks.loadRx).toHaveBeenCalledWith('client-1')
  })

  it('处方读失败时计划列表仍返回，处方是空', async () => {
    mocks.loadRx.mockRejectedValue(new Error('db down'))
    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.plans).toEqual([{ id: 'plan-old', status: 'approved' }])
    expect(json.prescription).toBeNull()
  })
})
