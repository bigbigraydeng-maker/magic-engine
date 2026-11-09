import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth/client-access', () => ({
  requireOperatorAccess: vi.fn().mockResolvedValue({
    ok: true, user: { id: 'test-user', email: 'fde@magiclab.com' }, role: 'admin', tier: 'admin', allowedClientId: null,
  }),
}))

const mockLand = vi.fn()
const mockGenerate = vi.fn()
const mockHuatuo = vi.fn()
vi.mock('@/lib/diagnostic/prescription-landing', () => ({ landPrescription: (...a: unknown[]) => mockLand(...a) }))
vi.mock('@/lib/diagnostic/prescription-generator', () => ({ generatePrescription: (...a: unknown[]) => mockGenerate(...a) }))
vi.mock('@/lib/huatuo/agent', () => ({ runHuatuo: (...a: unknown[]) => mockHuatuo(...a) }))

const mockAttach = vi.fn()
vi.mock('@/lib/ads-strategy/plan-seed/attach', () => ({ attachPlanSeed: (...a: unknown[]) => mockAttach(...a) }))

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOperatorAccess } from '@/lib/auth/client-access'

const params = { id: 'client-1' }

function chain(data: unknown) {
  const builder: Record<string, unknown> = {}
  const self = () => builder
  for (const name of ['select', 'eq', 'order', 'limit']) builder[name] = self
  builder.maybeSingle = async () => ({ data, error: null })
  builder.single = async () => ({ data, error: null })
  return builder
}

function payload() {
  return {
    goal_id: 'goal-1', status: 'approved', agent_name: 'huatuo', version: 99, run_id: 'spoof-run',
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

function request(body: unknown): NextRequest {
  return new NextRequest('http://test/api/clients/client-1/prescriptions/manual', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function mockDb(options: { goal?: unknown; run?: unknown; version?: unknown; order?: string[] } = {}) {
  const inserts: Array<Record<string, unknown>> = []
  const tables: string[] = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    tables.push(table)
    if (table === 'goals') return chain(options.goal === undefined ? { id: 'goal-1', client_id: 'client-1' } : options.goal)
    if (table === 'diagnostic_runs') return chain(options.run === undefined ? { id: 'run-9' } : options.run)
    const builder = chain(options.version === undefined ? { version: 4 } : options.version)
    builder.insert = (row: Record<string, unknown>) => {
      inserts.push(row)
      if (options.order) options.order.push('insert')
      return { select: () => ({ single: async () => ({ data: { id: 'rx-new' }, error: null }) }) }
    }
    return builder
  })
  return { inserts, tables }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAttach.mockImplementation(async (c: unknown) => c)
  ;(requireOperatorAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true, user: { id: 'test-user', email: 'fde@magiclab.com' }, role: 'admin', tier: 'admin', allowedClientId: null,
  })
})

describe('POST /prescriptions/manual — attachPlanSeed wiring', () => {
  it('calls attachPlanSeed once with the parsed content and client/goal ids, and inserts what it returns', async () => {
    const { inserts } = mockDb()
    const attached = {
      summary: 'from-attach', plan_seed: { marker: 1 }, phases: [], kpi_targets: [], budget_allocation: [],
    }
    mockAttach.mockResolvedValue(attached)

    const res = await POST(request(payload()), { params })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true })

    expect(mockAttach).toHaveBeenCalledTimes(1)
    const [contentArg, ctxArg] = mockAttach.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(contentArg).toMatchObject({ summary: '人工草稿' })
    expect(ctxArg).toEqual({ clientId: 'client-1', goalId: 'goal-1' })

    expect(inserts).toHaveLength(1)
    expect(inserts[0].content).toEqual(attached)
  })

  it('still returns 200 and inserts the original content when attachPlanSeed rejects', async () => {
    const { inserts } = mockDb()
    mockAttach.mockRejectedValue(new Error('boom'))

    const res = await POST(request(payload()), { params })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ success: true })
    expect(inserts).toHaveLength(1)
    expect((inserts[0].content as { summary: string }).summary).toBe('人工草稿')
  })

  it('calls attachPlanSeed before inserting the prescription row', async () => {
    const order: string[] = []
    mockDb({ order })
    mockAttach.mockImplementation(async (c: unknown) => {
      order.push('attach')
      return c
    })

    const res = await POST(request(payload()), { params })

    expect(res.status).toBe(200)
    expect(order).toEqual(['attach', 'insert'])
  })

  it('returns 422 and does not call attach or insert when validation fails', async () => {
    const { inserts } = mockDb()
    const bad = payload()
    ;(bad.content.phases[0].initiative_seed as Record<string, unknown>).ad_plays = 'not-a-list'

    const res = await POST(request(bad), { params })

    expect(res.status).toBe(422)
    expect(mockAttach).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it('passes a valid ad_plays array through to attachPlanSeed intact', async () => {
    mockDb()
    const withPlays = payload()
    const adPlays = [{ step_key: 's1', play: 'lead_form_harvest' }]
    ;(withPlays.content.phases[0].initiative_seed as Record<string, unknown>).ad_plays = adPlays

    const res = await POST(request(withPlays), { params })

    expect(res.status).toBe(200)
    expect(mockAttach).toHaveBeenCalledTimes(1)
    const [contentArg] = mockAttach.mock.calls[0] as [{
      phases: Array<{ initiative_seed: { ad_plays: unknown } }>
    }]
    expect(contentArg.phases[0].initiative_seed.ad_plays).toEqual(adPlays)
  })

  it('never forwards a forged top-level content.plan_seed to attachPlanSeed', async () => {
    mockDb()
    const forged = payload()
    ;(forged.content as Record<string, unknown>).plan_seed = { forged: true }

    const res = await POST(request(forged), { params })

    expect(res.status).toBe(200)
    expect(mockAttach).toHaveBeenCalledTimes(1)
    const [contentArg] = mockAttach.mock.calls[0] as [Record<string, unknown>]
    expect('plan_seed' in contentArg).toBe(false)
  })
})
