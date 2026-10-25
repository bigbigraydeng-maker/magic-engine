import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'fde@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
}))

const mockLand = vi.fn()
const mockGenerate = vi.fn()
const mockHuatuo = vi.fn()
vi.mock('@/lib/diagnostic/prescription-landing', () => ({
  landPrescription: (...args: unknown[]) => mockLand(...args),
}))
vi.mock('@/lib/diagnostic/prescription-generator', () => ({
  generatePrescription: (...args: unknown[]) => mockGenerate(...args),
}))
vi.mock('@/lib/huatuo/agent', () => ({
  runHuatuo: (...args: unknown[]) => mockHuatuo(...args),
}))

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { MANUAL_PRESCRIPTION_AGENT } from '@/lib/diagnostic/manual-prescription'

const params = { id: 'client-1' }

function chain(data: unknown) {
  const builder: Record<string, unknown> = {}
  const self = () => builder
  builder.select = self
  builder.eq = self
  builder.order = self
  builder.limit = self
  builder.maybeSingle = async () => ({ data, error: null })
  builder.single = async () => ({ data, error: null })
  return builder
}

function action(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    phase: 1,
    title: '建成暂停',
    description: '人工执行',
    dimension: 'ads',
    fix_type: 'fde_manual',
    module: 'manual',
    execution_target: { flywheel: 'ads', mode: 'external_manual', vendor: 'fde' },
    effort: 'low',
    impact: 'high',
    finding_ids: [],
    ...over,
  }
}

function payload(over: Record<string, unknown> = {}) {
  return {
    goal_id: 'goal-1',
    status: 'approved',
    agent_name: 'huatuo',
    version: 99,
    run_id: 'spoof-run',
    generation_meta: { source: 'huatuo', source_refs: ['ref-1'] },
    content: {
      summary: '人工草稿',
      kpi_targets: [],
      budget_allocation: [],
      phases: [{
        phase_number: 1,
        name: '准备',
        duration_weeks: 1,
        initiative_seed: {
          initiative_type: 'demand_generation',
          title: '建系列',
          posture: 'fast',
          budget_percent: 100,
        },
        actions: [action()],
      }],
    },
    ...over,
  }
}

function request(body: unknown): NextRequest {
  return new NextRequest('http://test/api/clients/client-1/prescriptions/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockDb(options: {
  goal?: unknown
  run?: unknown
  version?: unknown
  insertError?: { message: string } | null
}) {
  const inserts: Array<Record<string, unknown>> = []
  const tables: string[] = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    tables.push(table)
    if (table === 'goals') return chain(options.goal === undefined ? { id: 'goal-1', client_id: 'client-1' } : options.goal)
    if (table === 'diagnostic_runs') return chain(options.run === undefined ? { id: 'run-9' } : options.run)
    const builder = chain(options.version === undefined ? { version: 4 } : options.version)
    builder.insert = (row: Record<string, unknown>) => {
      inserts.push(row)
      return {
        select: () => ({
          single: async () => ({
            data: options.insertError ? null : { id: 'rx-new' },
            error: options.insertError ?? null,
          }),
        }),
      }
    }
    return builder
  })
  return { inserts, tables }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'fde@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  })
})

describe('POST /prescriptions/manual', () => {
  it('inserts a draft with the next version, the latest run, and 广告 Agent', async () => {
    const { inserts, tables } = mockDb({})
    const res = await POST(request(payload()), { params })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      prescription_id: 'rx-new',
      status: 'draft',
      version: 5,
      agent_name: MANUAL_PRESCRIPTION_AGENT,
      goal_id: 'goal-1',
      run_id: 'run-9',
      view_path: '/dashboard/clients/client-1/prescription/new?goal_id=goal-1',
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      status: 'draft',
      agent_name: MANUAL_PRESCRIPTION_AGENT,
      version: 5,
      run_id: 'run-9',
      goal_id: 'goal-1',
      supersedes_id: null,
      discovery_id: null,
      intake: null,
    })
    expect(inserts[0].approved_at).toBeUndefined()
    expect((inserts[0].generation_meta as { source: string }).source).toBe('manual')
    expect(tables).not.toContain('execution_items')
    expect(tables).not.toContain('initiatives')
    expect(mockLand).not.toHaveBeenCalled()
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockHuatuo).not.toHaveBeenCalled()
  })

  it('starts at version 1 when the goal has no prescription yet', async () => {
    const { inserts } = mockDb({ version: null })
    const res = await POST(request(payload()), { params })
    expect(res.status).toBe(200)
    expect(inserts[0].version).toBe(1)
  })

  it('returns 422 when the client has no completed diagnostic run', async () => {
    const { inserts } = mockDb({ run: null })
    const res = await POST(request(payload()), { params })
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.error).toContain('还没有已完成的体检')
    expect(inserts).toHaveLength(0)
  })

  it('returns 422 when the goal belongs to another client', async () => {
    const { inserts, tables } = mockDb({ goal: { id: 'goal-1', client_id: 'other' } })
    const res = await POST(request(payload()), { params })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('不属于这个客户')
    expect(inserts).toHaveLength(0)
    expect(tables).not.toContain('prescriptions')
  })

  it('rejects a non-manual action before writing', async () => {
    const { inserts } = mockDb({})
    const bad = payload()
    ;(bad.content.phases[0].actions[0] as { fix_type: string }).fix_type = 'me_auto'
    const res = await POST(request(bad), { params })
    expect(res.status).toBe(422)
    expect(inserts).toHaveLength(0)
    expect(mockLand).not.toHaveBeenCalled()
  })

  it('uses the same paid-client access check as the other prescription routes', async () => {
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 402,
      error: 'paid only',
    })
    const res = await POST(request(payload()), { params })
    expect(res.status).toBe(402)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
