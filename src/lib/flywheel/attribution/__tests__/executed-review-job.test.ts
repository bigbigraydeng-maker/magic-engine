import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUDGET_CARD_ACTION, PAUSE_CARD_ACTION, type ReviewSource } from '../executed-review'

const hoisted = vi.hoisted(() => ({
  actions: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
  upsertError: null as { message: string } | null,
}))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const name of ['select', 'not', 'eq', 'lt', 'gte', 'lte', 'order', 'limit', 'is', 'neq', 'delete', 'update']) {
    chain[name] = passthrough
  }
  chain.range = () => Promise.resolve({ data: hoisted.actions, error: null })
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
  chain.upsert = (row: Record<string, unknown>) => {
    hoisted.upserts.push(row)
    return Promise.resolve({ data: null, error: hoisted.upsertError })
  }
  chain.then = (resolve: (value: { data: null; error: null }) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve)
  return { supabaseAdmin: { from: () => chain } }
})

const SOURCE: ReviewSource = {
  prescriptionId: 'rx-1', version: 2, goalId: 'goal-1', planId: 'plan-1', planHash: 'hash-1', approvedOn: '2026-11-01',
}
const DUE = new Date('2026-02-01T00:00:00.000Z')

function budget(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'budget-1', client_id: 'client-1', flywheel: 'ads', action_type: BUDGET_CARD_ACTION,
    payload: {
      status: 'executed', direction: 'down', observationWindowDays: 7,
      order: { expectedMetric: 'ads.account.cpa', direction: 'down', observationWindowDays: 7, adsetId: 'set-a' },
      lock: SOURCE,
    },
    expected_metric: 'ads.account.cpa', expected_delta: -1, executed_at: '2026-01-01T00:00:00.000Z',
    execution_item_id: null, action_run_id: 'run-1', vendor: 'meta', ...over,
  }
}

beforeEach(() => {
  hoisted.actions = []
  hoisted.upserts = []
  hoisted.upsertError = null
})

describe('attribution consumes the card window', () => {
  it('skips a waiting card, waits out the card window, and does not use 14 days', async () => {
    const { runAttributionJob } = await import('../job')
    hoisted.actions = [budget({ payload: { ...(budget().payload as object), status: 'holding' } })]
    expect((await runAttributionJob({ windowDays: 14, now: DUE })).not_evaluable).toBe(1)
    expect(hoisted.upserts).toEqual([])

    hoisted.actions = [budget()]
    expect((await runAttributionJob({ windowDays: 14, now: new Date('2026-01-02T00:00:00.000Z') })).written).toBe(0)
    const due = await runAttributionJob({ windowDays: 14, now: DUE })
    expect(due.written).toBe(1)
    await runAttributionJob({ now: DUE })
    expect(hoisted.upserts.map(row => row.window_days)).toEqual([7, 7])
    expect(hoisted.upserts[0]).toMatchObject({
      metric_key: 'ads.account.cpa', verdict: 'inconclusive', confidence: 0, baseline: null, after_value: null,
    })
  })

  it('shows a save failure and refuses a card with no approval source', async () => {
    const { runAttributionJob } = await import('../job')
    hoisted.actions = [budget()]
    hoisted.upsertError = { message: 'constraint rejected the row' }
    expect((await runAttributionJob({ now: DUE })).failed).toBe(1)
    expect(hoisted.upserts).toHaveLength(1)

    hoisted.upserts = []
    hoisted.upsertError = null
    const payload = { ...(budget().payload as Record<string, unknown>) }
    delete payload.lock
    hoisted.actions = [budget({ payload })]
    expect((await runAttributionJob({ now: DUE })).failed).toBe(1)
    expect(hoisted.upserts).toEqual([])
  })

  it('pairs the same object and does not treat a pause as success', async () => {
    hoisted.actions = [
      budget(),
      budget({
        id: 'pause-1', action_type: PAUSE_CARD_ACTION, expected_metric: 'ads.account.spend', expected_delta: null,
        payload: {
          status: 'executed', source: SOURCE,
          order: { metric: 'ads.account.spend', direction: 'pause', observationDays: 7, adsetId: 'set-a' },
        },
      }),
    ]
    const { runAttributionJob } = await import('../job')
    const result = await runAttributionJob({ windowDays: 30, now: DUE })
    expect(result.written).toBe(2)
    expect(hoisted.upserts.map(row => [row.verdict, row.window_days, row.baseline])).toEqual([
      ['inconclusive', 7, null],
      ['inconclusive', 7, null],
    ])
  })
})
