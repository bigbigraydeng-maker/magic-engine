import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PlanSeedDeps } from '@/lib/ads-strategy/plan-seed/build'

type PrescriptionRow = {
  id: string
  client_id: string
  goal_id: string | null
  updated_at: string
  content: unknown
}

type MarketingPlanRow = {
  id: string
  client_id: string
  updated_at: string
  status: string
  plan_data: unknown
}

type Store = {
  prescriptions: PrescriptionRow[]
  marketing_plans: MarketingPlanRow[]
}

type WriteRecord = { table: string; method: 'insert' | 'update' | 'upsert' | 'delete' }

type ThenableResult = { data: null; error: null }

type QueryBuilder = {
  select: () => QueryBuilder
  eq: (col: string, val: unknown) => QueryBuilder
  maybeSingle: () => Promise<{ data: PrescriptionRow | MarketingPlanRow | null; error: { message: string } | null }>
  insert: (row: unknown) => ThenableChain
  update: (patch: unknown) => ThenableChain
  upsert: (row: unknown) => ThenableChain
  delete: () => ThenableChain
}

type ThenableChain = PromiseLike<ThenableResult> & {
  eq: (col: string, val: unknown) => ThenableChain
  select: () => ThenableChain
}

const hoisted = vi.hoisted(() => {
  const makeContent = (play: string) => ({
    summary: 's',
    phases: [
      {
        phase_number: 1,
        name: 'p',
        duration_weeks: 1,
        actions: [],
        initiative_seed: {
          initiative_type: 'demand_generation',
          title: 't',
          ad_plays: [{ step_key: 's1', play }],
        },
      },
    ],
  })

  const freshStore = (): Store => ({
    prescriptions: [
      {
        id: 'p1',
        client_id: 'c1',
        goal_id: 'g1',
        updated_at: '2026-10-20T00:00:00Z',
        content: makeContent('thruplay_pool_build'),
      },
      {
        id: 'p2',
        client_id: 'other',
        goal_id: 'g2',
        updated_at: '2026-10-21T00:00:00Z',
        content: makeContent('thruplay_pool_build'),
      },
      {
        id: 'p3',
        client_id: 'c1',
        goal_id: null,
        updated_at: '2026-10-22T00:00:00Z',
        content: { summary: 'no plays', phases: [] },
      },
    ],
    marketing_plans: [
      {
        id: 'm1',
        client_id: 'c1',
        updated_at: '2026-10-19T00:00:00Z',
        status: 'draft',
        plan_data: { promo: {} },
      },
      {
        id: 'm2',
        client_id: 'c1',
        updated_at: '2026-10-18T00:00:00Z',
        status: 'approved',
        plan_data: {},
      },
    ],
  })

  const state: {
    store: Store
    writes: WriteRecord[]
    failRead: boolean
  } = {
    store: freshStore(),
    writes: [],
    failRead: false,
  }

  const makeThenable = (): ThenableChain => {
    const promise = Promise.resolve<ThenableResult>({ data: null, error: null })
    const chain: ThenableChain = {
      then: (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected),
      eq: () => chain,
      select: () => chain,
    }
    return chain
  }

  const fakeFrom = (table: string): QueryBuilder => {
    const filters: Array<{ col: string; val: unknown }> = []
    const builder: QueryBuilder = {
      select: () => builder,
      eq: (col, val) => {
        filters.push({ col, val })
        return builder
      },
      maybeSingle: async () => {
        if (state.failRead) {
          return { data: null, error: { message: 'x' } }
        }
        const rows = (state.store as unknown as Record<string, Array<Record<string, unknown>>>)[table] ?? []
        const match = rows.find((row) => filters.every((f) => row[f.col] === f.val))
        return { data: (match ?? null) as PrescriptionRow | MarketingPlanRow | null, error: null }
      },
      insert: (row) => {
        state.writes.push({ table, method: 'insert' })
        const rows = (state.store as unknown as Record<string, Array<Record<string, unknown>>>)[table]
        if (rows) rows.push(row as Record<string, unknown>)
        return makeThenable()
      },
      update: (patch) => {
        state.writes.push({ table, method: 'update' })
        const rows = (state.store as unknown as Record<string, Array<Record<string, unknown>>>)[table]
        if (rows) {
          for (const row of rows) {
            Object.assign(row, patch as Record<string, unknown>)
            row.updated_at = 'TOUCHED'
          }
        }
        return makeThenable()
      },
      upsert: (row) => {
        state.writes.push({ table, method: 'upsert' })
        const rows = (state.store as unknown as Record<string, Array<Record<string, unknown>>>)[table]
        if (rows) rows.push(row as Record<string, unknown>)
        return makeThenable()
      },
      delete: () => {
        state.writes.push({ table, method: 'delete' })
        const rows = (state.store as unknown as Record<string, Array<Record<string, unknown>>>)[table]
        if (rows) rows.length = 0
        return makeThenable()
      },
    }
    return builder
  }

  const testDeps = (): PlanSeedDeps => ({
    now: () => new Date('2026-10-26T02:00:00Z'),
    loadOwnedAccounts: async () => [{ id: 'act_A', cap: 10000, label: 'A' }],
    loadFacts: async () => ({
      headroom: { ok: true, headroom_minor: 15000, delivering_minor: 5000, cap_minor: 20000, currency: 'NZD', as_of: null },
      account_cap_minor: 10000,
      account_delivering_minor: 0,
      account_status: 1,
      daily: [],
      today: '2026-10-26',
      committed_minor: 0,
      insights_as_of: null,
      audiences: [],
      audiences_complete: true,
      approved_creatives: [],
      budget_share_of_headroom: 0.5,
      min_audience_size: 1000,
      max_creatives: 3,
    }),
    loadCaptureAt: async () => '2026-10-26T00:00:00Z',
    loadClientPageId: async () => '555',
    getPageToken: async () => 'tok',
    readForms: async () => ({ state: 'ok', value: [] }),
    readScopes: async () => ({
      source: 'client_page',
      scopes: { state: 'ok', value: ['leads_retrieval', 'pages_manage_ads'] },
    }),
    readPromotePages: async () => ({ state: 'ok', value: ['555'] }),
    playbookShare: async () => 0.5,
  })

  return { state, freshStore, fakeFrom, testDeps }
})

vi.mock('@/lib/auth/client-access', () => ({ requirePlanApproverAccess: vi.fn() }))
vi.mock('@/lib/ads-strategy/plan-seed/deps', () => ({
  productionDeps: () => hoisted.testDeps(),
  loadGoalPeriod: vi.fn(async () => ({ start_date: '2026-10-27', end_date: '2026-11-10' })),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => hoisted.fakeFrom(table) },
}))

import { GET } from '../route'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'

const requirePlanApproverAccessMock = vi.mocked(requirePlanApproverAccess)

const callGet = (id: string, pId: string) =>
  GET(new NextRequest('http://test/x'), { params: { id, pId } })

const snapshot = (): Store => JSON.parse(JSON.stringify(hoisted.state.store)) as Store

const expectNoWrites = (before: Store) => {
  expect(hoisted.state.writes).toEqual([])
  expect(hoisted.state.store.prescriptions).toEqual(before.prescriptions)
  expect(hoisted.state.store.marketing_plans).toEqual(before.marketing_plans)
  expect(hoisted.state.store.prescriptions.length).toBe(before.prescriptions.length)
  expect(hoisted.state.store.marketing_plans.length).toBe(before.marketing_plans.length)
  expect(hoisted.state.store.prescriptions.map((r) => r.updated_at)).toEqual(
    before.prescriptions.map((r) => r.updated_at),
  )
  expect(hoisted.state.store.marketing_plans.map((r) => r.updated_at)).toEqual(
    before.marketing_plans.map((r) => r.updated_at),
  )
}

beforeEach(() => {
  hoisted.state.store = hoisted.freshStore()
  hoisted.state.writes = []
  hoisted.state.failRead = false
  requirePlanApproverAccessMock.mockReset()
  requirePlanApproverAccessMock.mockResolvedValue({
    ok: true,
    user: { id: 'u', email: 'a@b.c' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  } as Awaited<ReturnType<typeof requirePlanApproverAccess>>)
})

describe('GET /api/clients/[id]/prescription/[pId]/plan-seed', () => {
  it('returns 403 when access is denied (approver_only)', async () => {
    requirePlanApproverAccessMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: '只有内部账号',
      reason: 'approver_only',
    })
    const before = snapshot()

    const res = await callGet('c1', 'p1')

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: '只有内部账号', reason: 'approver_only' })
    expectNoWrites(before)
  })

  it('returns 401 when login is missing', async () => {
    requirePlanApproverAccessMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: '请先登录',
      reason: 'unauthorized',
    })
    const before = snapshot()

    const res = await callGet('c1', 'p1')

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: '请先登录', reason: 'unauthorized' })
    expectNoWrites(before)
  })

  it('returns 404 for a prescription belonging to another client', async () => {
    const before = snapshot()

    const res = await callGet('c1', 'p2')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: '处方不存在' })
    expectNoWrites(before)
  })

  it('returns 404 for an unknown prescription id', async () => {
    const before = snapshot()

    const res = await callGet('c1', 'does-not-exist')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: '处方不存在' })
    expectNoWrites(before)
  })

  it('returns seed:null with a reason when the prescription has no ad_plays', async () => {
    const before = snapshot()

    const res = await callGet('c1', 'p3')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.seed).toBeNull()
    expect(typeof body.reason).toBe('string')
    expect(body.reason).toContain('ad_plays')
    expectNoWrites(before)
  })

  it('builds a plan seed for a prescription with ad_plays', async () => {
    const before = snapshot()

    const res = await callGet('c1', 'p1')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.seed).not.toBeNull()
    expect(body.seed.ad_steps.length).toBe(1)
    expect(body.seed.ad_steps[0].daily_budget_cents.ok).toBe(true)
    expect(body.seed.ad_steps[0].daily_budget_cents.value).toBe(5000)
    expect(typeof body.computed_at).toBe('string')
    expectNoWrites(before)
  })

  it('returns 500 when the DB read fails', async () => {
    hoisted.state.failRead = true
    const before = snapshot()

    const res = await callGet('c1', 'p1')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expectNoWrites(before)
  })
})
