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
vi.mock('@/lib/huatuo/client-kind', () => ({
  resolveIntakeClientKind: vi.fn(async (_db, _clientId, intake: unknown) => intake),
}))

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { MANUAL_PRESCRIPTION_AGENT } from '@/lib/diagnostic/manual-prescription'

const params = { id: 'client-1' }

type RecordedQuery = { table: string; select?: string; filters: string[] }

function chain(data: unknown, query?: RecordedQuery) {
  const builder: Record<string, unknown> = {}
  builder.select = (cols?: string) => {
    if (query && cols !== undefined) query.select = cols
    return builder
  }
  builder.eq = (col: string, value: unknown) => {
    query?.filters.push(`${col}=${String(value)}`)
    return builder
  }
  builder.order = (col: string, opts?: { ascending?: boolean }) => {
    query?.filters.push(`order:${col}:${opts?.ascending === false ? 'desc' : 'asc'}`)
    return builder
  }
  builder.limit = (n: number) => {
    query?.filters.push(`limit:${n}`)
    return builder
  }
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

function mockDb(options: { goal?: unknown; run?: unknown; version?: unknown } = {}) {
  const inserts: Array<Record<string, unknown>> = []
  const tables: string[] = []
  const queries: RecordedQuery[] = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    tables.push(table)
    const query: RecordedQuery = { table, filters: [] }
    queries.push(query)
    if (table === 'goals') return chain(options.goal === undefined ? { id: 'goal-1', client_id: 'client-1' } : options.goal, query)
    if (table === 'diagnostic_runs') return chain(options.run === undefined ? { id: 'run-9' } : options.run, query)
    const builder = chain(options.version === undefined ? { version: 4 } : options.version, query)
    builder.insert = (row: Record<string, unknown>) => {
      inserts.push(row)
      return { select: () => ({ single: async () => ({ data: { id: 'rx-new' }, error: null }) }) }
    }
    return builder
  })
  return { inserts, tables, queries }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireOperatorAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true, user: { id: 'test-user', email: 'fde@magiclab.com' }, role: 'admin', tier: 'admin', allowedClientId: null,
  })
})

describe('POST /prescriptions/manual', () => {
  it('stores optional intake when business goal and budget are present', async () => {
    const { inserts } = mockDb()
    const body = {
      ...payload(),
      intake: { business_goal: '推线索', monthly_budget_aud: 1200, budget_currency: 'NZD' },
    }
    const res = await POST(request(body), { params })
    expect(res.status).toBe(200)
    expect(inserts[0].intake).toMatchObject({
      business_goal: '推线索',
      monthly_budget_aud: 1200,
      budget_currency: 'NZD',
    })
  })

  it('rejects intake missing business_goal or budget', async () => {
    const { inserts } = mockDb()
    const res = await POST(request({ ...payload(), intake: { business_goal: '推线索' } }), { params })
    expect(res.status).toBe(400)
    expect(inserts).toHaveLength(0)
  })

  it('inserts a draft with the latest run id and the next version', async () => {
    const { inserts, tables, queries } = mockDb()
    const res = await POST(request(payload()), { params })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      success: true, prescription_id: 'rx-new', status: 'draft', version: 5,
      agent_name: MANUAL_PRESCRIPTION_AGENT, goal_id: 'goal-1', run_id: 'run-9',
      view_path: '/dashboard/clients/client-1/prescription/new?goal_id=goal-1',
    })
    expect(inserts[0]).toMatchObject({
      status: 'draft', agent_name: MANUAL_PRESCRIPTION_AGENT, version: 5, run_id: 'run-9',
      goal_id: 'goal-1', supersedes_id: null, discovery_id: null, intake: null,
    })
    expect(inserts[0].run_id).not.toBe('spoof-run')
    const runQuery = queries.find((query) => query.table === 'diagnostic_runs')
    expect(runQuery?.select).toBe('id')
    expect(runQuery?.filters).toEqual([
      'client_id=client-1',
      'order:created_at:desc',
      'limit:1',
    ])
    expect(tables).not.toContain('diagnostic_findings')
    expect(inserts[0].approved_at).toBeUndefined()
    expect((inserts[0].generation_meta as { source: string }).source).toBe('manual')
    expect(tables).not.toContain('execution_items')
    expect(tables).not.toContain('initiatives')
    expect(mockLand).not.toHaveBeenCalled()
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockHuatuo).not.toHaveBeenCalled()
  })

  it('stores a null run id when the client has no diagnostic run', async () => {
    const { inserts, tables, queries } = mockDb({ run: null })
    const res = await POST(request(payload()), { params })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.run_id).toBeNull()
    expect(inserts[0].run_id).toBeNull()
    const runQuery = queries.find((query) => query.table === 'diagnostic_runs')
    expect(runQuery?.select).toBe('id')
    expect(runQuery?.filters).not.toContain('status=completed')
    expect(tables).toContain('diagnostic_runs')
    expect(tables).not.toContain('diagnostic_findings')
    expect(tables).toContain('prescriptions')
  })

  it('starts at version 1 when the goal has no prescription yet', async () => {
    const { inserts } = mockDb({ version: null })
    expect((await POST(request(payload()), { params })).status).toBe(200)
    expect(inserts[0].version).toBe(1)
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
    const { inserts } = mockDb()
    const bad = payload()
    bad.content.phases[0].actions[0].fix_type = 'me_auto'
    const res = await POST(request(bad), { params })
    expect(res.status).toBe(422)
    expect(inserts).toHaveLength(0)
    expect(mockLand).not.toHaveBeenCalled()
  })

  it('returns the operator-gate status and does not write when access is denied', async () => {
    ;(requireOperatorAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const res = await POST(request(payload()), { params })
    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
