import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  from: vi.fn(),
  listSteps: vi.fn(),
  getDecision: vi.fn(),
  tables: {} as Record<string, { rows: unknown[]; error?: { message: string } | null }>,
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => m.from(table) } }))
vi.mock('@/lib/kernel', () => ({ createKernel: vi.fn(() => ({ kernel: true })) }))
vi.mock('@/lib/kernel/store', () => ({ listSteps: m.listSteps, getDecision: m.getDecision }))
vi.mock('@/lib/meta/adsets', () => ({ listAdSetsInCampaign: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/action-submission/ads-o1-budget-scale', () => ({
  ADS_O1_BUDGET_SCALE_ACTION_KEY: 'ads.scale_unit_budget',
  requireAdsO1BudgetScaleAccess: vi.fn().mockResolvedValue({
    ok: true, tier: 'admin', allowedClientId: null, user: { id: 'staff-1', email: 'staff@example.com' },
  }),
  submitAdsO1BudgetScale: vi.fn(),
}))

import { GET } from './route'

const CLIENT_ID = 'aaaaaaaa-0000-0000-0000-000000000000'
const ADSET_ID = '120000000000001'
const ACCOUNT_ID = 'act_1111111111'
const RUN_FINISHED_AT = '2026-10-01T12:05:00.000Z'
const NOW = '2026-10-23T14:00:00.000Z'

function dateShift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function budgetSnapshot(budget: number, capturedAt: string) {
  return {
    client_id: CLIENT_ID, platform: 'meta', ad_account_id: ACCOUNT_ID,
    level: 'adset', entity_id: ADSET_ID, daily_budget_minor: budget, captured_at: capturedAt,
  }
}

function filteredQuery(rows: unknown[], error: { message: string } | null = null) {
  const filters: Array<{ column: string; op: 'eq' | 'gte' | 'lte'; value: unknown }> = []
  const orders: Array<{ column: string; ascending: boolean }> = []
  let rowLimit: number | null = null
  const query: Record<string, any> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn((column: string, value: unknown) => { filters.push({ column, op: 'eq', value }); return query })
  query.gte = vi.fn((column: string, value: unknown) => { filters.push({ column, op: 'gte', value }); return query })
  query.lte = vi.fn((column: string, value: unknown) => { filters.push({ column, op: 'lte', value }); return query })
  query.order = vi.fn((column: string, options?: { ascending?: boolean }) => { orders.push({ column, ascending: options?.ascending ?? true }); return query })
  query.limit = vi.fn((limit: number) => { rowLimit = limit; return query })
  const result = () => {
    let selected = (rows as Array<Record<string, unknown>>).filter(row => filters.every(filter => {
      const value = row[filter.column]
      if (filter.op === 'eq') return value === filter.value
      if (filter.op === 'gte') return String(value ?? '') >= String(filter.value)
      return String(value ?? '') <= String(filter.value)
    }))
    for (const order of orders.reverse()) {
      selected = [...selected].sort((a, b) => String(a[order.column] ?? '').localeCompare(String(b[order.column] ?? '')) * (order.ascending ? 1 : -1))
    }
    if (rowLimit !== null) selected = selected.slice(0, rowLimit)
    return selected
  }
  query.maybeSingle = vi.fn().mockImplementation(async () => ({ data: result()[0] ?? null, error }))
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result(), error }).then(resolve, reject)
  return query
}

function buildRun() {
  const baselineStart = '2026-09-17'
  const baselineEnd = '2026-09-30'
  const baselineDaily = Array.from({ length: 14 }, (_, index) => ({ date: dateShift(baselineStart, index), value: 10 }))
  return {
    id: 'run-1', client_id: CLIENT_ID, goal_id: 'goal-1', action_key: 'ads.scale_unit_budget', status: 'succeeded',
    input: { adset_id: ADSET_ID, ad_account_id: ACCOUNT_ID, before_cents: 5000, after_cents: 6000 },
    evidence: {
      date: '2026-10-01', currency: 'USD', current_daily_budget_cents: 5000, proposed_daily_budget_cents: 6000,
      budget_observation: {
        schema: 1, metric_key: 'leads_count', metric_label: 'CTS Tours 新增线索', target_direction: 'increase',
        target_level: 'adset', target_id: ADSET_ID, ad_account_id: ACCOUNT_ID, timezone: 'UTC',
        baseline: { start: baselineStart, end: baselineEnd, days: 14, total: 140, daily: baselineDaily, metric_key: 'leads_count', captured_at: '2026-10-01T12:00:00.000Z' },
        baseline_unavailable_reason: null,
      },
    },
    rationale: 'O1 连续三天点击率高于账户中位数。', authorization_decision_id: 'decision-1',
    created_at: '2026-10-01T12:00:00.000Z', started_at: '2026-10-01T12:04:00.000Z', finished_at: RUN_FINISHED_AT,
  }
}

function setup(snapshotRows: unknown[], snapshotError: { message: string } | null = null) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  const afterRows = Array.from({ length: 14 }, (_, index) => ({
    client_id: CLIENT_ID, ad_account_id: ACCOUNT_ID, platform: 'meta', level: 'adset', entity_id: ADSET_ID,
    insight_date: dateShift('2026-10-02', index), leads: 15, messaging_conversations: 0,
  }))
  m.tables = {
    action_runs: { rows: [buildRun()] },
    ad_daily_insights: { rows: afterRows },
    ad_entity_snapshots: { rows: snapshotRows, error: snapshotError },
  }
  m.from.mockImplementation((table: string) => {
    const data = m.tables[table] ?? { rows: [] }
    return filteredQuery(data.rows, data.error ?? null)
  })
  m.listSteps.mockResolvedValue([
    { step_key: 'apply', status: 'succeeded', output: { applied: true, adset_id: ADSET_ID, prior_daily_budget_cents: 5000, new_daily_budget_cents: 6000 }, finished_at: RUN_FINISHED_AT, verification: null },
    { step_key: 'readback', status: 'succeeded', output: { adset_id: ADSET_ID, daily_budget_now: 6000 }, finished_at: RUN_FINISHED_AT, verification: { passed: true, checks: [] } },
  ])
  m.getDecision.mockResolvedValue({
    id: 'decision-1', action_run_id: 'run-1', client_id: CLIENT_ID, action_key: 'ads.scale_unit_budget',
    verdict: 'allow', decided_by: 'human', created_at: '2026-10-01T12:03:00.000Z',
  })
}

async function getObservation() {
  const response = await GET(new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/ad-health/o1-scale`), { params: { id: CLIENT_ID } })
  return await response.json() as { items: Array<{ observation: { conclusion: string; budget_matches_this_run?: boolean; reason: string } }> }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  const currentSnapshot = budgetSnapshot(6000, NOW)
  setup([currentSnapshot])
})

describe('O1 budget observation GET snapshot history', () => {
  it('continues observing when an external budget excursion was later restored to the approved amount', async () => {
    setup([
      budgetSnapshot(6000, '2026-10-01T12:10:00.000Z'),
      budgetSnapshot(9000, '2026-10-10T12:00:00.000Z'),
      budgetSnapshot(6000, '2026-10-23T13:00:00.000Z'),
    ])

    const result = await getObservation()

    expect(m.listSteps).toHaveBeenCalled()
    expect(m.getDecision).toHaveBeenCalled()
    expect(result.items[0].observation).toMatchObject({
      conclusion: 'continue_observing', budget_matches_this_run: false,
    })
    expect(result.items[0].observation.reason).toContain('外部变更')
  })

  it('keeps an observation only when every recorded post-execution budget snapshot matches and the latest is fresh', async () => {
    const result = await getObservation()

    expect(result.items[0].observation).toMatchObject({ conclusion: 'keep', budget_matches_this_run: true })
  })

  it('continues observing when the human approval decision is missing', async () => {
    m.getDecision.mockResolvedValue(null)

    const result = await getObservation()

    expect(m.getDecision).toHaveBeenCalled()
    expect(result.items[0].observation.conclusion).toBe('continue_observing')
  })

  it('continues observing when budget snapshot history is missing or unreadable', async () => {
    setup([])
    expect((await getObservation()).items[0].observation.conclusion).toBe('continue_observing')

    setup([], { message: 'offline fixture read failure' })
    expect((await getObservation()).items[0].observation.conclusion).toBe('continue_observing')
  })
})
