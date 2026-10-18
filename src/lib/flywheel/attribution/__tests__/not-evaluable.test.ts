import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const state: {
    actionRows: Array<Record<string, unknown>>
    tablesTouched: string[]
  } = {
    actionRows: [],
    tablesTouched: [],
  }
  return state
})

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  chain.select = passthrough
  chain.not = passthrough
  chain.eq = passthrough
  chain.lt = passthrough
  chain.gte = passthrough
  chain.lte = passthrough
  chain.order = passthrough
  chain.limit = passthrough
  chain.is = passthrough
  chain.neq = passthrough
  chain.delete = passthrough
  chain.update = passthrough
  chain.upsert = passthrough
  chain.range = () => Promise.resolve({ data: hoisted.actionRows, error: null })
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
  chain.then = (
    resolve: (value: { data: null; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({ data: null, error: null }).then(resolve, reject)

  return {
    supabaseAdmin: {
      from: (table: string) => {
        hoisted.tablesTouched.push(table)
        return chain
      },
    },
  }
})

function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'a1',
    client_id: 'c1',
    flywheel: 'ads',
    action_type: 'x',
    payload: {},
    expected_metric: 'ads.account.cost_per_lead',
    expected_delta: null,
    executed_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    execution_item_id: null,
    action_run_id: null,
    vendor: null,
    ...over,
  }
}

beforeEach(() => {
  hoisted.actionRows = []
  hoisted.tablesTouched.length = 0
  vi.clearAllMocks()
})

describe('runAttributionJob not_evaluable', () => {
  it('marks a Zhuge suggestion as not_evaluable without touching outcomes', async () => {
    hoisted.actionRows = [row({ payload: { zhuge_session_key: 'k1' } })]
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.not_evaluable).toBe(1)
    expect(result.written).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.unattributable).toBe(0)
    expect(result.deferred).toBe(0)
    expect(result.failed).toBe(0)
    expect(hoisted.tablesTouched).toEqual(['flywheel_actions'])
    expect(result.pass2ClientIds).toEqual([])
  })

  it('marks a discovery recommendation as not_evaluable', async () => {
    hoisted.actionRows = [row({ payload: { discovery_id: 'd1' }, vendor: null })]
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.not_evaluable).toBe(1)
    expect(result.written).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.unattributable).toBe(0)
    expect(result.deferred).toBe(0)
    expect(result.failed).toBe(0)
    expect(hoisted.tablesTouched).toEqual(['flywheel_actions'])
    expect(result.pass2ClientIds).toEqual([])
  })

  it('marks a proactive signal as not_evaluable', async () => {
    hoisted.actionRows = [row({ payload: { source: 'proactive_signal' } })]
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.not_evaluable).toBe(1)
  })

  it('still evaluates a meta vendor row with a discovery_id', async () => {
    hoisted.actionRows = [row({ vendor: 'meta', payload: { discovery_id: 'd1' } })]
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.not_evaluable).toBe(0)
    expect(hoisted.tablesTouched).toContain('flywheel_metrics')
  })

  it('still evaluates a row with an execution_item_id', async () => {
    hoisted.actionRows = [
      row({ execution_item_id: 'card-1', payload: { discovery_id: 'd1' } }),
    ]
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.not_evaluable).toBe(0)
    expect(hoisted.tablesTouched).toContain('flywheel_metrics')
  })

  it('still evaluates a google_ads vendor row with an empty payload', async () => {
    hoisted.actionRows = [row({ vendor: 'google_ads', payload: {} })]
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.not_evaluable).toBe(0)
    expect(hoisted.tablesTouched).toContain('flywheel_metrics')
  })

  it('still evaluates a normal action with no markers', async () => {
    hoisted.actionRows = [row({ payload: {}, vendor: null })]
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.not_evaluable).toBe(0)
    expect(hoisted.tablesTouched).toContain('flywheel_metrics')
  })

  it('counts not_evaluable and skipped in a mixed batch', async () => {
    hoisted.actionRows = [
      row({ id: 'a1', payload: { zhuge_session_key: 'k1' } }),
      row({ id: 'a2', payload: { discovery_id: 'd1' } }),
      row({ id: 'a3', payload: {}, vendor: null }),
    ]
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.processed).toBe(3)
    expect(result.not_evaluable).toBe(2)
    expect(result.skipped).toBe(1)
  })

  it('returns without setting not_evaluable for an empty batch', async () => {
    hoisted.actionRows = []
    const { runAttributionJob } = await import('../job')

    const result = await runAttributionJob()

    expect(result.not_evaluable).toBeUndefined()
  })
})
