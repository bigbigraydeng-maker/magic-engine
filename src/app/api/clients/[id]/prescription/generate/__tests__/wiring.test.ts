import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted refs ────────────────────────────────────────────────────────────

const dbRef = vi.hoisted(() => ({ current: null as null | { from: (t: string) => unknown } }))
const mockAttach = vi.hoisted(() => vi.fn())

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => dbRef.current!.from(t) },
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireOperatorAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'u', email: 'fde@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
}))

vi.mock('@/lib/strategy/goals', () => ({
  getGoalById: vi.fn().mockResolvedValue({ id: 'goal-1', client_id: 'client-1' }),
  listActiveGoals: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/huatuo/agent', () => ({
  // fresh object per call: the route reassigns result.content
  runHuatuo: vi.fn(async () => ({
    content: { summary: 'orig', phases: [], kpi_targets: [], budget_allocation: [] },
    self_grade: { overall: 80 },
    meta: { agent_version: 'v1' },
    benchmarks_used: [],
    trend_summary: null,
  })),
}))

vi.mock('@/lib/memory', () => ({
  loadMemoryForClient: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/diagnostic/prescription-generator', () => ({
  generatePrescription: vi.fn(),
}))

vi.mock('@/lib/case-library/saver', () => ({
  savePrescriptionCase: vi.fn().mockResolvedValue(undefined),
  deriveCrisisType: vi.fn().mockReturnValue('x'),
}))

vi.mock('@/lib/ads/budget-currency', () => ({
  prepareBudgetIntake: (i: unknown) => ({ ok: true, intake: i }),
  audOnlyAmount: () => 1000,
}))

vi.mock('@/lib/huatuo/industry-mapper', () => ({
  mapIndustryToCategory: () => 'other',
}))

vi.mock('@/lib/ads-strategy/plan-seed/attach', () => ({
  attachPlanSeed: (...a: unknown[]) => mockAttach(...a),
}))

// ─── Import route AFTER mocks ────────────────────────────────────────────────

import { POST } from '../route'

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
        data:
          table === 'prescriptions' && writes.some(w => w.op === 'insert')
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

function parseSse(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(JSON.parse(line.slice('data: '.length)) as Record<string, unknown>)
    }
  }
  return events
}

function makeRequest(): NextRequest {
  return new NextRequest('http://test/api/clients/client-1/prescription/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal_id: 'goal-1',
      discovery_id: 'd1',
      intake: { business_goal: 'leads', monthly_budget_aud: 1000 },
    }),
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /prescription/generate — attachPlanSeed wiring', () => {
  let writes: Write[]

  beforeEach(() => {
    vi.clearAllMocks()
    writes = []
    const tables: Record<string, unknown> = {
      client_discovery: {
        id: 'd1',
        payload: { business: { industry: 'x' } },
        confirmed_at: '2026-01-01T00:00:00Z',
      },
      prescriptions: null,
    }
    dbRef.current = makeDb(tables, writes)
  })

  it('uses the value returned by attachPlanSeed', async () => {
    const attachReturn = { summary: 'from-attach', phases: [], plan_seed: { marker: 1 } }
    mockAttach.mockResolvedValue(attachReturn)

    const res = await POST(makeRequest(), { params: { id: 'client-1' } })
    const text = await res.text()
    const events = parseSse(text)

    // attach called once with runHuatuo content + { clientId, goalId }
    expect(mockAttach).toHaveBeenCalledTimes(1)
    const [firstArg, secondArg] = mockAttach.mock.calls[0] as [unknown, unknown]
    expect(firstArg).toEqual({
      summary: 'orig',
      phases: [],
      kpi_targets: [],
      budget_allocation: [],
    })
    expect(secondArg).toEqual({ clientId: 'client-1', goalId: 'goal-1' })

    // exactly one update on prescriptions with status 'draft' whose content === attachReturn
    const draftUpdates = writes.filter(
      w => w.table === 'prescriptions' && w.op === 'update' && w.payload.status === 'draft',
    )
    expect(draftUpdates).toHaveLength(1)
    expect(draftUpdates[0].payload).toHaveProperty('content')
    expect(draftUpdates[0].payload.content).toEqual(attachReturn)

    // SSE done event content === attachReturn
    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
    expect(done!.content).toEqual(attachReturn)
  })

  it('still saves the original content when attachPlanSeed rejects', async () => {
    mockAttach.mockRejectedValue(new Error('boom'))

    const res = await POST(makeRequest(), { params: { id: 'client-1' } })
    const text = await res.text()
    const events = parseSse(text)

    const draftUpdates = writes.filter(
      w => w.table === 'prescriptions' && w.op === 'update' && w.payload.status === 'draft',
    )
    expect(draftUpdates).toHaveLength(1)
    const savedContent = draftUpdates[0].payload.content as { summary?: string }
    expect(savedContent.summary).toBe('orig')

    expect(events.some(e => e.type === 'done')).toBe(true)
    expect(events.some(e => e.type === 'error')).toBe(false)
  })
})
