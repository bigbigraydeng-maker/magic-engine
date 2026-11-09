import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth/client-access', () => ({
  requireOperatorAccess: vi.fn().mockResolvedValue({
    ok: true, user: { id: 'u', email: 'fde@magiclab.com' }, role: 'admin', tier: 'admin', allowedClientId: null,
  }),
}))
vi.mock('@/lib/ads-strategy/plan-seed/attach', () => ({ attachPlanSeed: async (c: unknown) => c }))

const mockHook = vi.fn()
vi.mock('@/lib/marketing-plan/promo/plan-draft-hook', () => ({
  afterPrescriptionDraftSaved: (...a: unknown[]) => mockHook(...a),
}))

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'

const params = { id: 'client-1' }

function chain(data: unknown) {
  const b: Record<string, unknown> = {}
  for (const n of ['select', 'eq', 'order', 'limit']) b[n] = () => b
  b.maybeSingle = async () => ({ data, error: null })
  b.single = async () => ({ data, error: null })
  return b
}

function body() {
  return {
    goal_id: 'goal-1',
    generation_meta: { source: 'huatuo', source_refs: ['ref-1'] },
    content: {
      summary: '人工草稿', kpi_targets: [], budget_allocation: [],
      phases: [{
        phase_number: 1, name: '准备', duration_weeks: 1,
        initiative_seed: { initiative_type: 'demand_generation', title: '建系列', posture: 'fast', budget_percent: 100 },
        actions: [{
          id: 'a1', phase: 1, title: '建成暂停', description: '人工执行', dimension: 'ads',
          fix_type: 'fde_manual', module: 'manual', effort: 'low', impact: 'high', finding_ids: [],
          execution_target: { flywheel: 'ads', mode: 'external_manual', vendor: 'fde' },
        }],
      }],
    },
  }
}

function mockDb(insertError: unknown = null) {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'goals') return chain({ id: 'goal-1', client_id: 'client-1' })
    if (table === 'diagnostic_runs') return chain({ id: 'run-9' })
    const b = chain({ version: 4 })
    b.insert = () => ({
      select: () => ({
        single: async () => (insertError
          ? { data: null, error: insertError }
          : { data: { id: 'rx-new' }, error: null }),
      }),
    })
    return b
  })
}

function req(): NextRequest {
  return new NextRequest('http://test/api/clients/client-1/prescriptions/manual', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHook.mockResolvedValue(undefined)
})

describe('POST /prescriptions/manual — plan draft hook', () => {
  it('pasted prescription: calls the hook once after the row is saved', async () => {
    mockDb()
    const res = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(mockHook).toHaveBeenCalledTimes(1)
    expect(mockHook).toHaveBeenCalledWith({ clientId: 'client-1', prescriptionId: 'rx-new' })
  })

  it('does not call the hook when the prescription save fails', async () => {
    mockDb({ message: 'db down' })
    const res = await POST(req(), { params })
    expect(res.status).toBe(500)
    expect(mockHook).not.toHaveBeenCalled()
  })
})
