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
  requireOperatorAccess: vi.fn(async () => ({
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

function parseSse(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(JSON.parse(line.slice('data: '.length)) as Record<string, unknown>)
    }
  }
  return events
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

  it('uses the value returned by attachPlanSeed and passes priorContent', async () => {
    const attachReturn = { summary: 'from-attach', phases: [], plan_seed: { marker: 1 } }
    mockAttach.mockResolvedValueOnce(attachReturn)

    const res = await POST(makeRequest(), { params: { id: 'client-1', pId: 'p1' } })
    const text = await res.text()
    const events = parseSse(text)

    // attach called once with refined content + correct options
    expect(mockAttach).toHaveBeenCalledTimes(1)
    const [firstArg, secondArg] = mockAttach.mock.calls[0] as [unknown, unknown]
    expect(firstArg).toEqual({ summary: 'refined', phases: [], kpi_targets: [], budget_allocation: [] })
    expect(secondArg).toEqual({
      clientId: 'client-1',
      goalId: 'goal-1',
      priorContent: { summary: 'old', phases: [], kpi_targets: [], budget_allocation: [] },
    })

    // draft update carries attach return value
    const draftUpdate = writes.find(
      (w) => w.table === 'prescriptions' && w.op === 'update' && w.payload.status === 'draft',
    )
    expect(draftUpdate).toBeDefined()
    expect(draftUpdate!.payload.content).toEqual(attachReturn)

    // done SSE event carries attach return value
    const done = events.find((e) => e.type === 'done')
    expect(done).toBeDefined()
    expect(done!.content).toEqual(attachReturn)
  })

  it('still saves refined content when attachPlanSeed rejects', async () => {
    mockAttach.mockRejectedValueOnce(new Error('boom'))

    const res = await POST(makeRequest(), { params: { id: 'client-1', pId: 'p1' } })
    const text = await res.text()
    const events = parseSse(text)

    const draftUpdate = writes.find(
      (w) => w.table === 'prescriptions' && w.op === 'update' && w.payload.status === 'draft',
    )
    expect(draftUpdate).toBeDefined()
    const savedContent = draftUpdate!.payload.content as { summary?: string }
    expect(savedContent.summary).toBe('refined')

    const done = events.find((e) => e.type === 'done')
    expect(done).toBeDefined()
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })
})
