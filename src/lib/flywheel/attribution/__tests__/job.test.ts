/**
 * Attribution Job unit tests — P12.A.8
 *
 * Tests cover:
 *  - computeVerdict() pure-function logic (no DB)
 *  - runAttributionJob() with mocked supabaseAdmin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeVerdict } from '../job'

// ── Fluent mock builder ───────────────────────────────────────────────────────

type ChainResult = { data: unknown; error: unknown }

function makeChain(terminal: Partial<Record<string, () => Promise<ChainResult>>> = {}) {
  const chain: Record<string, unknown> = {}
  const fluent = [
    'select', 'not', 'eq', 'lt', 'gte', 'lte',
    'order', 'limit', 'delete', 'insert',
  ]
  for (const m of fluent) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  for (const [method, impl] of Object.entries(terminal)) {
    chain[method] = vi.fn().mockImplementation(impl)
  }
  return chain
}

// ── Shared mock queue for maybeSingle ─────────────────────────────────────────

let maybeSingleQueue: Array<() => Promise<ChainResult>> = []
let insertResult: ChainResult = { data: null, error: null }
let deleteResult: ChainResult = { data: null, error: null }

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  const fluent = [
    'select', 'not', 'eq', 'lt', 'gte', 'lte',
    'order', 'limit', 'delete', 'insert',
  ]
  for (const m of fluent) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain['maybeSingle'] = vi.fn().mockImplementation(async () => {
    const next = maybeSingleQueue.shift()
    return next ? next() : { data: null, error: null }
  })
  chain['insert'] = vi.fn().mockImplementation(async () => insertResult)
  chain['delete'] = vi.fn().mockReturnValue({
    eq: vi.fn().mockImplementation(async () => deleteResult),
  })

  return {
    supabaseAdmin: {
      from: vi.fn().mockReturnValue(chain),
    },
  }
})

// ── computeVerdict — pure function tests ──────────────────────────────────────

describe('computeVerdict', () => {
  it('returns inconclusive when |delta_pct| < 3', () => {
    expect(computeVerdict(0.001, 1.5, 0.05).verdict).toBe('inconclusive')
    expect(computeVerdict(-0.001, -1.5, -0.05).verdict).toBe('inconclusive')
  })

  it('returns inconclusive when deltaPct is null', () => {
    // baseline = 0 → deltaPct = null
    expect(computeVerdict(0.1, null, 0.05).verdict).toBe('inconclusive')
  })

  it('confirmed when delta matches positive expected direction', () => {
    // mention_rate +20% → well above noise floor
    const r = computeVerdict(0.1, 20, 0.05)
    expect(r.verdict).toBe('confirmed')
    expect(r.confidence).toBeGreaterThanOrEqual(0.35)
  })

  it('confirmed when delta matches negative expected direction', () => {
    // avg_rank -20% (rank dropped from 5 to 4 = improvement)
    const r = computeVerdict(-1, -20, -0.5)
    expect(r.verdict).toBe('confirmed')
  })

  it('reversed when delta is opposite to expected direction', () => {
    const r = computeVerdict(-0.1, -20, 0.05)
    expect(r.verdict).toBe('reversed')
  })

  it('inconclusive when expected direction matches but confidence < 0.35', () => {
    // delta_pct = 5% → confidence = 5/20 = 0.25 → inconclusive
    const r = computeVerdict(0.05, 5, 0.05)
    expect(r.verdict).toBe('inconclusive')
    expect(r.confidence).toBe(0.25)
  })

  it('falls back to sign of delta when expectedDelta is null', () => {
    expect(computeVerdict(0.1, 10, null).verdict).toBe('confirmed')
    expect(computeVerdict(-0.1, -10, null).verdict).toBe('reversed')
  })

  it('falls back to sign of delta when expectedDelta is 0', () => {
    expect(computeVerdict(0.1, 10, 0).verdict).toBe('confirmed')
  })

  it('caps confidence at 0.95 for very large changes', () => {
    const r = computeVerdict(1, 200, 0.1)
    expect(r.confidence).toBe(0.95)
  })
})

// ── runAttributionJob — integration tests with mocked DB ──────────────────────

describe('runAttributionJob', () => {
  beforeEach(() => {
    maybeSingleQueue = []
    insertResult = { data: null, error: null }
    deleteResult = { data: null, error: null }
    vi.clearAllMocks()
  })

  it('returns { processed:0, written:0, skipped:0 } when no actions exist', async () => {
    // actions fetch returns empty array
    maybeSingleQueue = []
    const { supabaseAdmin } = await import('@/lib/supabase')
    // Override from to return data:[] for the actions query
    const chain = makeChain()
    ;(chain as Record<string, unknown>)['not'] = vi.fn().mockReturnValue({ data: [], error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(chain as ReturnType<typeof supabaseAdmin.from>)

    const { runAttributionJob } = await import('../job')
    const result = await runAttributionJob()
    expect(result).toEqual({ processed: 0, written: 0, skipped: 0 })
  })

  it('skips action when no baseline metric exists', async () => {
    // actions query returns 1 action
    const { supabaseAdmin } = await import('@/lib/supabase')
    const actionsChain = makeChain()
    ;(actionsChain as Record<string, unknown>)['not'] = vi.fn().mockReturnValue({
      data: [{
        id: 'action-1',
        client_id: 'client-1',
        expected_metric: 'geo.query.mention_rate',
        expected_delta: 0.05,
        executed_at: new Date().toISOString(),
      }],
      error: null,
    })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(
      actionsChain as ReturnType<typeof supabaseAdmin.from>
    )

    // baseline maybySingle → null (no baseline)
    maybeSingleQueue.push(async () => ({ data: null, error: null }))

    const { runAttributionJob } = await import('../job')
    const result = await runAttributionJob()
    expect(result.skipped).toBe(1)
    expect(result.written).toBe(0)
  })

  it('skips action when baseline exists but no after-metric yet', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase')
    const actionsChain = makeChain()
    ;(actionsChain as Record<string, unknown>)['not'] = vi.fn().mockReturnValue({
      data: [{
        id: 'action-2',
        client_id: 'client-1',
        expected_metric: 'geo.query.mention_rate',
        expected_delta: 0.05,
        executed_at: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
      }],
      error: null,
    })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(
      actionsChain as ReturnType<typeof supabaseAdmin.from>
    )

    // baseline → exists
    maybeSingleQueue.push(async () => ({ data: { metric_value: 0.3 }, error: null }))
    // after → null (too early)
    maybeSingleQueue.push(async () => ({ data: null, error: null }))

    const { runAttributionJob } = await import('../job')
    const result = await runAttributionJob()
    expect(result.skipped).toBe(1)
    expect(result.written).toBe(0)
  })

  it('writes an outcome when both baseline and after exist', async () => {
    const { supabaseAdmin } = await import('@/lib/supabase')
    const pastDate = new Date(Date.now() - 5 * 86_400_000) // 5 days ago
    const actionsChain = makeChain()
    ;(actionsChain as Record<string, unknown>)['not'] = vi.fn().mockReturnValue({
      data: [{
        id: 'action-3',
        client_id: 'client-1',
        expected_metric: 'geo.query.mention_rate',
        expected_delta: 0.05,
        executed_at: pastDate.toISOString(),
      }],
      error: null,
    })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(
      actionsChain as ReturnType<typeof supabaseAdmin.from>
    )

    // baseline → 0.30
    maybeSingleQueue.push(async () => ({ data: { metric_value: 0.30 }, error: null }))
    // after → 0.42 (+40%)
    maybeSingleQueue.push(async () => ({ data: { metric_value: 0.42 }, error: null }))

    const { runAttributionJob } = await import('../job')
    const result = await runAttributionJob()
    expect(result.written).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('increments skipped and logs error when DB throws on insert', async () => {
    insertResult = { data: null, error: { message: 'insert failed' } }

    const { supabaseAdmin } = await import('@/lib/supabase')
    const pastDate = new Date(Date.now() - 5 * 86_400_000)
    const actionsChain = makeChain()
    ;(actionsChain as Record<string, unknown>)['not'] = vi.fn().mockReturnValue({
      data: [{
        id: 'action-4',
        client_id: 'client-1',
        expected_metric: 'geo.query.mention_rate',
        expected_delta: 0.05,
        executed_at: pastDate.toISOString(),
      }],
      error: null,
    })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(
      actionsChain as ReturnType<typeof supabaseAdmin.from>
    )

    maybeSingleQueue.push(async () => ({ data: { metric_value: 0.30 }, error: null }))
    maybeSingleQueue.push(async () => ({ data: { metric_value: 0.42 }, error: null }))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { runAttributionJob } = await import('../job')
    const result = await runAttributionJob()
    expect(result.skipped).toBe(1)
    consoleSpy.mockRestore()
  })
})
