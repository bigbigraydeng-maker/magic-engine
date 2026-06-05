/**
 * P34.4 — innermost isolation tests for scoped-queries.
 *
 * The whole point of this layer (子牙 B5) is that EVERY query is bound to a
 * client_id. These tests are the mutation anchors: if anyone removes a
 * .eq('client_id', ...) from any method, the matching test fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { createScopedQueries } from '../scoped-queries'
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const GOAL_ID = 'gggggggg-0000-0000-0000-000000000001'

const mockFrom = vi.mocked(supabaseAdmin.from)

/**
 * A chainable query stub that records every .eq() call and resolves to the
 * given result. Supports the builder methods our queries use.
 */
function makeChain(result: { data: unknown; count?: number; error: unknown }) {
  const eqCalls: Array<[string, unknown]> = []
  const chain: Record<string, unknown> = {}
  const ret = () => chain
  chain.select = vi.fn(ret)
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val])
    return chain
  })
  chain.neq = vi.fn(ret)
  chain.in = vi.fn(ret)
  chain.order = vi.fn(ret)
  chain.limit = vi.fn(ret)
  // Terminal resolvers
  chain.maybeSingle = vi.fn(() => Promise.resolve(result))
  // Make the chain itself awaitable (for queries that end on .order/.limit)
  chain.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled)
  return { chain, eqCalls }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createScopedQueries', () => {
  it('throws on empty clientId (defence in depth)', () => {
    expect(() => createScopedQueries('')).toThrow()
    // @ts-expect-error testing runtime guard
    expect(() => createScopedQueries(undefined)).toThrow()
  })
})

describe('every method scopes by client_id', () => {
  it('getOverview filters all three queries by client_id', async () => {
    const diag = makeChain({ data: null, error: null })
    const blog = makeChain({ data: null, count: 0, error: null })
    const social = makeChain({ data: null, count: 0, error: null })
    mockFrom
      .mockReturnValueOnce(diag.chain as never)
      .mockReturnValueOnce(blog.chain as never)
      .mockReturnValueOnce(social.chain as never)

    await createScopedQueries(CLIENT_ID).getOverview()

    expect(diag.eqCalls).toContainEqual(['client_id', CLIENT_ID])
    expect(blog.eqCalls).toContainEqual(['client_id', CLIENT_ID])
    expect(social.eqCalls).toContainEqual(['client_id', CLIENT_ID])
  })

  it('listGoals filters by client_id', async () => {
    const { chain, eqCalls } = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain as never)
    await createScopedQueries(CLIENT_ID).listGoals()
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
  })

  it('listGoals adds a status filter when provided', async () => {
    const { chain, eqCalls } = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain as never)
    await createScopedQueries(CLIENT_ID).listGoals('active')
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
    expect(eqCalls).toContainEqual(['status', 'active'])
  })

  it('getGoalDetail filters by BOTH client_id AND id', async () => {
    const { chain, eqCalls } = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain as never)
    await createScopedQueries(CLIENT_ID).getGoalDetail(GOAL_ID)
    // Both filters required: knowing another tenant's goalId must not work.
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
    expect(eqCalls).toContainEqual(['id', GOAL_ID])
  })

  it('getTraffic filters by client_id and returns ok with snapshots', async () => {
    const { chain, eqCalls } = makeChain({ data: [{ total_sessions: 100 }], error: null })
    mockFrom.mockReturnValue(chain as never)
    const res = await createScopedQueries(CLIENT_ID).getTraffic()
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
    // ok-branch contract (魏征 Y1): mutating the final return to pending_sync must fail here.
    expect(res.status).toBe('ok')
    if (res.status === 'ok') expect(res.snapshots).toHaveLength(1)
  })

  it('getTraffic returns pending_sync when empty', async () => {
    const { chain } = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain as never)
    const res = await createScopedQueries(CLIENT_ID).getTraffic()
    expect(res.status).toBe('pending_sync')
  })

  it('getSeoPerformance filters by client_id', async () => {
    const { chain, eqCalls } = makeChain({ data: [{ site_url: 'x' }], error: null })
    mockFrom.mockReturnValue(chain as never)
    await createScopedQueries(CLIENT_ID).getSeoPerformance()
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
  })

  it('listExecutionItems filters by client_id', async () => {
    const { chain, eqCalls } = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain as never)
    await createScopedQueries(CLIENT_ID).listExecutionItems()
    expect(eqCalls).toContainEqual(['client_id', CLIENT_ID])
  })
})

describe('result shaping', () => {
  it('getSeoPerformance returns pending_sync when empty', async () => {
    const { chain } = makeChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain as never)
    const res = await createScopedQueries(CLIENT_ID).getSeoPerformance()
    expect(res.status).toBe('pending_sync')
  })

  it('getSeoPerformance returns ok with snapshots when present', async () => {
    const { chain } = makeChain({
      data: [{ site_url: 'https://x', total_clicks: 10 }],
      error: null,
    })
    mockFrom.mockReturnValue(chain as never)
    const res = await createScopedQueries(CLIENT_ID).getSeoPerformance()
    expect(res.status).toBe('ok')
    if (res.status === 'ok') expect(res.snapshots).toHaveLength(1)
  })

  it('listExecutionItems groups by dimension and excludes skipped via .neq', async () => {
    const { chain } = makeChain({
      data: [
        { id: '1', title: 'A', status: 'pending', dimension: 'seo', due_date: null },
        { id: '2', title: 'B', status: 'in_progress', dimension: 'seo', due_date: null },
        { id: '3', title: 'C', status: 'pending', dimension: 'ads', due_date: '2026-07-01' },
      ],
      error: null,
    })
    mockFrom.mockReturnValue(chain as never)
    const res = await createScopedQueries(CLIENT_ID).listExecutionItems()
    expect(Object.keys(res).sort()).toEqual(['ads', 'seo'])
    expect(res.seo).toHaveLength(2)
    expect(res.ads[0].due_date).toBe('2026-07-01')
    // .neq('status','skipped') must be applied at the query layer
    expect((chain as { neq: ReturnType<typeof vi.fn> }).neq).toHaveBeenCalledWith('status', 'skipped')
  })

  it('getOverview returns content counts and null diagnostic when none', async () => {
    const diag = makeChain({ data: null, error: null })
    const blog = makeChain({ data: null, count: 3, error: null })
    const social = makeChain({ data: null, count: 5, error: null })
    mockFrom
      .mockReturnValueOnce(diag.chain as never)
      .mockReturnValueOnce(blog.chain as never)
      .mockReturnValueOnce(social.chain as never)

    const res = await createScopedQueries(CLIENT_ID).getOverview()
    expect(res.diagnostic).toBeNull()
    expect(res.content).toEqual({ blog_published: 3, social_delivered: 5 })
  })
})
