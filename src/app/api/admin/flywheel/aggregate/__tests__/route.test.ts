/**
 * GET /api/admin/flywheel/aggregate — unit tests (P22.B.3)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockQuery = vi.fn()
let rangesAsked: Array<[number, number]> = []

const mocks = vi.hoisted(() => ({
  guardAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: mocks.guardAdmin,
}))

// The route chains optional .eq() calls on the query object.
// We build a Proxy that always returns itself, terminating with mockQuery()
// only when actually awaited — this handles any chain length.
const makeChainable = (): object => {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        // Make it thenable — delegate to mockQuery().
        //
        // Bound on purpose: the previous version pulled `then` off the promise
        // and called it detached, so `this` was undefined and V8 threw
        // "Promise.prototype.then called on incompatible receiver". Every test
        // in this file that actually awaited the query has been red since — 3 of
        // the repo's standing failures. Awaiting the mock has to behave like
        // awaiting the real query, or the suite is only testing the guard.
        return (...args: unknown[]) => {
          const p = Promise.resolve(mockQuery())
          if (prop === 'then') return p.then(...(args as [never, never]))
          if (prop === 'catch') return p.catch(...(args as [never]))
          return p.finally(...(args as [never]))
        }
      }
      // `.range()` is the terminal now that the route pages. Range-aware on
      // purpose: a stub that hands back everything regardless cannot see a
      // paging bug, which is how the fold-without-paging gap survived a round.
      if (prop === 'range') {
        return async (from: number, to: number) => {
          const res = (await mockQuery()) as { data: unknown[] | null; error: unknown }
          rangesAsked.push([from, to])
          return { data: (res.data ?? []).slice(from, to + 1), error: res.error }
        }
      }
      // Every other accessor (eq, select, from, order…) returns the same proxy
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => makeChainable() },
}))

import { GET } from '../route'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * One row per ACTION — each with a distinct action_id, because the route now
 * collapses per action before counting. Rows sharing an action_id are readings
 * of one event, not separate samples.
 */
function outcome(
  actionId: string,
  verdict: string,
  actionType: string,
  flywheel: string,
  clientId: string,
  over: Record<string, unknown> = {},
) {
  return {
    action_id: actionId,
    metric_key: 'ads.spend',
    window_days: 14,
    verdict,
    flywheel_actions: {
      action_type: actionType, flywheel, client_id: clientId,
      expected_metric: 'ads.spend',
    },
    ...over,
  }
}

const OUTCOMES_WITH_ACTIONS = [
  outcome('a1', 'confirmed',    'ads.pause_campaign', 'ads', 'c1'),
  outcome('a2', 'confirmed',    'ads.pause_campaign', 'ads', 'c1'),
  outcome('a3', 'inconclusive', 'ads.pause_campaign', 'ads', 'c2'),
  outcome('a4', 'confirmed',    'seo.publish_blog',   'seo', 'c1'),
  outcome('a5', 'reversed',     'seo.publish_blog',   'seo', 'c2'),
]

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost:3001/api/admin/flywheel/aggregate')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/flywheel/aggregate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rangesAsked = []
    mocks.guardAdmin.mockResolvedValue(null) // null = admin authenticated, proceed
    mockQuery.mockResolvedValue({ data: OUTCOMES_WITH_ACTIONS, error: null })
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when not admin (guardAdmin returns a Response)', async () => {
    const stubResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mocks.guardAdmin.mockResolvedValue(stubResponse)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 with top, total_actions, total_outcomes', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.top).toBeDefined()
    expect(typeof json.total_actions).toBe('number')
    expect(typeof json.total_outcomes).toBe('number')
  })

  it('total_outcomes equals the number of rows returned', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    expect(json.total_outcomes).toBe(OUTCOMES_WITH_ACTIONS.length)
  })

  it('ranks ads.pause_campaign higher than seo.publish_blog (2 confirmed vs 1)', async () => {
    const res = await GET(makeRequest({ min: '1' }))
    const json = await res.json()
    const firstId = json.top[0].action_type
    expect(firstId).toBe('ads.pause_campaign')
  })

  it('respects min param — excludes action_types with fewer outcomes', async () => {
    // seo.publish_blog has 2 outcomes; ads.pause_campaign has 3
    const res = await GET(makeRequest({ min: '3' }))
    const json = await res.json()
    // Only ads.pause_campaign (3 outcomes) qualifies
    expect(json.top.every((e: { action_type: string }) => e.action_type === 'ads.pause_campaign')).toBe(true)
  })

  it('respects top param — limits number of entries returned', async () => {
    const res = await GET(makeRequest({ top: '1', min: '1' }))
    const json = await res.json()
    expect(json.top.length).toBeLessThanOrEqual(1)
  })

  it('clamps top to max 20', async () => {
    // We can't directly test the DB call limit, but ensure no crash with large top
    const res = await GET(makeRequest({ top: '999', min: '1' }))
    expect(res.status).toBe(200)
  })

  // ── Filters ───────────────────────────────────────────────────────────────

  it('includes filters in response body', async () => {
    const res = await GET(makeRequest({ client_id: 'c1', flywheel: 'ads' }))
    const json = await res.json()
    expect(json.filters.client_id).toBe('c1')
    expect(json.filters.flywheel).toBe('ads')
  })

  it('filters.client_id is null when not provided', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()
    expect(json.filters.client_id).toBeNull()
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 when DB errors', async () => {
    mockQuery.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('returns empty top array when no data matches', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null })
    const res = await GET(makeRequest())
    const json = await res.json()
    expect(json.top).toEqual([])
    expect(json.total_outcomes).toBe(0)
  })
})

// ── One action is one sample, however many rows it has ──────────────────────

describe('counting by action, not by row', () => {
  it('does not let one action count three times through its three metrics', async () => {
    // A GSC action yields clicks, impressions and avg_position from one snapshot
    // pair. Counting rows let a single action clear the `min` threshold on its
    // own and pull the success rate with it. (Codex P2, round 26.)
    mockQuery.mockResolvedValue({
      data: [
        outcome('a1', 'confirmed', 'seo.publish_blog', 'seo', 'c1', {
          metric_key: 'seo.gsc.clicks',
          flywheel_actions: { action_type: 'seo.publish_blog', flywheel: 'seo', client_id: 'c1', expected_metric: 'seo.gsc.clicks' },
        }),
        outcome('a1', 'reversed', 'seo.publish_blog', 'seo', 'c1', {
          metric_key: 'seo.gsc.impressions',
          flywheel_actions: { action_type: 'seo.publish_blog', flywheel: 'seo', client_id: 'c1', expected_metric: 'seo.gsc.clicks' },
        }),
        outcome('a1', 'reversed', 'seo.publish_blog', 'seo', 'c1', {
          metric_key: 'seo.gsc.avg_position',
          flywheel_actions: { action_type: 'seo.publish_blog', flywheel: 'seo', client_id: 'c1', expected_metric: 'seo.gsc.clicks' },
        }),
      ],
      error: null,
    })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.total_outcomes).toBe(1)
  })

  it('does not double-count an action that has two windows', async () => {
    // What turning ATTRIBUTION_DUAL_WINDOW_ENABLED on produces: the same metric
    // answered at the cadence window and at pass 1's. Two answers to different
    // questions about ONE action, not two actions.
    mockQuery.mockResolvedValue({
      data: [
        outcome('a1', 'confirmed', 'seo.publish_blog', 'seo', 'c1', { window_days: 28 }),
        outcome('a1', 'reversed',  'seo.publish_blog', 'seo', 'c1', { window_days: 14 }),
      ],
      error: null,
    })

    const res = await GET(makeRequest({ min: '1' }))
    const body = await res.json()

    expect(body.total_outcomes).toBe(1)
    // The mature window is the one that represents the action.
    expect(body.top[0].confirmed).toBe(1)
  })
})

// ── Reading every page, not just the first ──────────────────────────────────

describe('paging', () => {
  it('counts an action whose rows sit past the 1000-row cap', async () => {
    const filler = Array.from({ length: 1000 }, (_, i) =>
      outcome(`n${i}`, 'confirmed', 'ads.pause_campaign', 'ads', 'c1'))
    mockQuery.mockResolvedValue({
      data: [...filler, outcome('late', 'confirmed', 'late.action', 'seo', 'c1')],
      error: null,
    })

    const res = await GET(makeRequest({ min: '1' }))
    const body = await res.json()

    expect(rangesAsked.length).toBeGreaterThan(1)
    expect(body.total_outcomes).toBe(1001)
    expect(body.top.some((t: { action_type: string }) => t.action_type === 'late.action')).toBe(true)
  })
})
