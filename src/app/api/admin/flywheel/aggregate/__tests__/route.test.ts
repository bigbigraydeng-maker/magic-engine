/**
 * GET /api/admin/flywheel/aggregate — unit tests (P22.B.3)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockQuery = vi.fn()

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
        // Make it thenable — delegate to mockQuery()
        return (...args: unknown[]) => {
          const p = mockQuery() as Promise<unknown>
          return (p as unknown as Record<string, unknown>)[String(prop)]?.(...args)
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

const OUTCOMES_WITH_ACTIONS = [
  { verdict: 'confirmed',    flywheel_actions: { action_type: 'ads.pause_campaign', flywheel: 'ads', client_id: 'c1' } },
  { verdict: 'confirmed',    flywheel_actions: { action_type: 'ads.pause_campaign', flywheel: 'ads', client_id: 'c1' } },
  { verdict: 'inconclusive', flywheel_actions: { action_type: 'ads.pause_campaign', flywheel: 'ads', client_id: 'c2' } },
  { verdict: 'confirmed',    flywheel_actions: { action_type: 'seo.publish_blog',   flywheel: 'seo', client_id: 'c1' } },
  { verdict: 'reversed',     flywheel_actions: { action_type: 'seo.publish_blog',   flywheel: 'seo', client_id: 'c2' } },
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
