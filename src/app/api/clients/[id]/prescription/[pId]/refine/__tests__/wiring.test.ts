import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── hoisted refs ─────────────────────────────────────────────────────────────

const dbRef = vi.hoisted(() => ({ current: null as null | { from: (t: string) => unknown } }))
const mockAttach = vi.hoisted(() => vi.fn())

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => dbRef.current!.from(t) },
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({
    ok: true,
    user: { id: 'u', email: 'fde@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  })),
}))

vi.mock('@/lib/huatuo/agent', () => ({
  refineHuatuoPrescription: vi.fn(async () => ({
    content: { summary: 'refined', phases: [], kpi_targets: [], budget_allocation: [] },
    self_grade: { overall: 85 },
    meta: { agent_version: 'v1' },
    trend_summary: null,
  })),
  coerceWeaknesses: vi.fn(() => [{ dimension: 'x', issue: 'y' }]),
}))

vi.mock('@/lib/memory', () => ({
  loadMemoryForClient: vi.fn(async () => null),
}))

vi.mock('@/lib/strategy/goals', () => ({
  getGoalById: vi.fn(async () => ({ id: 'goal-1', client_id: 'client-1' })),
}))

vi.mock('@/lib/ads-strategy/plan-seed/attach', () => ({
  attachPlanSeed: (...a: unknown[]) => mockAttach(...a),
}))

// ─── import route AFTER mocks ─────────────────────────────────────────────────

import { POST } from '../route'
import { refineHuatuoPrescription } from '@/lib/huatuo/agent'

// ─── helpers ──────────────────────────────────────────────────────────────────

type Write = { table: string; op: 'insert' | 'update'; payload: Record<string, unknown> }

function makeDb(tables: Record<string, unknown>, writes: Write[]) {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {}
      const chain = () => q
      for (const m of ['select', 'eq', 'order', 'limit', 'in', 'is', 'gte', 'lte', 'neq']) q[m] = chain
      q.insert = (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', payload })
        return q
      }
      q.update = (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'update', payload })
        return q
      }
      const result = async () => ({
        data: table === 'prescriptions' && writes.some((w) => w.op === 'insert')
          ? { id: 'p-new' }
          : tables[table] ?? null,
        error: null,
      })
      q.single = result
      q.maybeSingle = result
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej)
      return q
    },
  }
}

function makeTables(): Record<string, unknown> {
  return {
    prescriptions: {
      id: 'p1',
      client_id: 'client-1',
      discovery_id: 'd1',
      status: 'draft',
      agent_name: 'huatuo',
      intake: { business_goal: 'leads', monthly_budget_aud: 1000 },
      content: { summary: 'old', phases: [], kpi_targets: [], budget_allocation: [] },
      self_grade: { weaknesses: [{ dimension: 'x', issue: 'y' }] },
      generation_meta: { passes: 1 },
      goal_id: 'goal-1',
    },
    client_discovery: {
      id: 'd1',
      payload: { business: { industry: 'x' } },
      confirmed_at: '2026-01-01T00:00:00Z',
    },
  }
}

function makeRequest(): NextRequest {
  return new NextRequest('http://test/api/clients/client-1/prescription/p1/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/clients/[id]/prescription/[pId]/refine — attachPlanSeed wiring', () => {
  let writes: Write[]

  beforeEach(() => {
    vi.clearAllMocks()
    writes = []
    dbRef.current = makeDb(makeTables(), writes)
  })

  async function settledDraft(): Promise<Write> {
    let found: Write | undefined
    await vi.waitFor(() => {
      found = writes.find(
        (w) => w.table === 'prescriptions' && w.op === 'update' && w.payload.content != null,
      )
      expect(found).toBeDefined()
    })
    return found!
  }

  it('returns before the refine model call finishes', async () => {
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((resolve) => { release = resolve })
    vi.mocked(refineHuatuoPrescription).mockImplementationOnce(
      () => gate as ReturnType<typeof refineHuatuoPrescription>,
    )
    mockAttach.mockResolvedValue({ summary: 'later' })

    const res = await POST(makeRequest(), { params: { id: 'client-1', pId: 'p1' } })
    const body = await res.json() as { prescription_id: string; status: string }

    expect(res.status).toBe(202)
    expect(body).toMatchObject({ prescription_id: 'p1', status: 'generating' })
    expect(writes.some((w) => w.payload.content != null)).toBe(false)

    release({
      content: { summary: 'refined', phases: [], kpi_targets: [], budget_allocation: [] },
      self_grade: { overall: 85 },
      meta: { agent_version: 'v1' },
      trend_summary: null,
      benchmarks_used: [],
    })
    const saved = await settledDraft()
    expect(saved.payload.content).toEqual({ summary: 'later' })
  })

  it('restarts the generated_at clock so an old draft is not judged stale on first poll', async () => {
    vi.mocked(refineHuatuoPrescription).mockResolvedValueOnce({
      content: { summary: 'x', phases: [], kpi_targets: [], budget_allocation: [] },
      self_grade: { overall: 85 },
      meta: { agent_version: 'v1' },
      trend_summary: null,
      benchmarks_used: [],
    } as never)
    mockAttach.mockResolvedValue({ summary: 'x' })

    const before = Date.now()
    await POST(makeRequest(), { params: { id: 'client-1', pId: 'p1' } })

    const mark = writes.find(
      (w) => w.table === 'prescriptions' && w.op === 'update' && w.payload.status === 'generating',
    )
    expect(mark).toBeDefined()
    expect(Date.parse(mark!.payload.generated_at as string)).toBeGreaterThanOrEqual(before)
    await settledDraft()
  })

  it('uses the value returned by attachPlanSeed and passes priorContent', async () => {
    const attachReturn = { summary: 'from-attach', phases: [], plan_seed: { marker: 1 } }
    mockAttach.mockResolvedValueOnce(attachReturn)

    const res = await POST(makeRequest(), { params: { id: 'client-1', pId: 'p1' } })
    expect(res.status).toBe(202)

    await vi.waitFor(() => expect(mockAttach).toHaveBeenCalledTimes(1))
    const [firstArg, secondArg] = mockAttach.mock.calls[0] as [unknown, unknown]
    expect(firstArg).toEqual({ summary: 'refined', phases: [], kpi_targets: [], budget_allocation: [] })
    expect(secondArg).toEqual({
      clientId: 'client-1',
      goalId: 'goal-1',
      priorContent: { summary: 'old', phases: [], kpi_targets: [], budget_allocation: [] },
    })

    const saved = await settledDraft()
    expect(saved.payload.content).toEqual(attachReturn)
  })

  it('keeps the old draft when refine throws, and records the error', async () => {
    vi.mocked(refineHuatuoPrescription).mockRejectedValueOnce(new Error('精修超时'))

    const res = await POST(makeRequest(), { params: { id: 'client-1', pId: 'p1' } })
    expect(res.status).toBe(202)

    await vi.waitFor(() => {
      const rolled = writes.find(
        (w) => w.table === 'prescriptions' && w.op === 'update' && w.payload.error_message === '精修超时',
      )
      expect(rolled?.payload.status).toBe('draft')
    })
  })

  it('still saves refined content when attachPlanSeed rejects', async () => {
    mockAttach.mockRejectedValueOnce(new Error('boom'))

    const res = await POST(makeRequest(), { params: { id: 'client-1', pId: 'p1' } })
    expect(res.status).toBe(202)

    const saved = await settledDraft()
    const savedContent = saved.payload.content as { summary?: string }
    expect(savedContent.summary).toBe('refined')
    expect(writes.some((w) => w.payload.status === 'failed')).toBe(false)
  })
})
