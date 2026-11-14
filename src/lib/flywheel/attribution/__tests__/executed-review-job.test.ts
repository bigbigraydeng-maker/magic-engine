import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUDGET_CARD_ACTION, CAMPAIGN_PAUSE_ACTION, PAUSE_CARD_ACTION, type ReviewSource } from '../executed-review'

const hoisted = vi.hoisted(() => ({
  actions: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
  upsertError: null as { message: string } | null,
  insights: [] as Array<Record<string, unknown>>,
  insightError: null as { message: string } | null,
  caseError: null as { message: string } | null,
  cases: [] as Array<Record<string, unknown>>,
  filters: [] as string[],
}))

vi.mock('../review-experience', () => ({
  persistReviewExperience: vi.fn(async () => 'skipped'),
}))

vi.mock('../review-verdict-rules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../review-verdict-rules')>()
  return {
    ...actual,
    loadClientReviewContext: vi.fn(async () => ({
      rules: actual.DEFAULT_REVIEW_VERDICT_RULES,
      targetCostPerPrimary: null,
      primary: 'lead' as const,
    })),
  }
})

vi.mock('@/lib/supabase', () => {
  function chainFor(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    for (const name of ['select', 'not', 'lt', 'gte', 'lte', 'order', 'limit', 'is', 'neq', 'delete', 'update', 'in', 'eq']) {
      chain[name] = passthrough
    }
    chain.eq = (column: string, value: unknown) => {
      hoisted.filters.push(`${table}.${column}=${String(value)}`)
      return chain
    }
    chain.update = (row: Record<string, unknown>) => {
      if (table === 'flywheel_actions') hoisted.cases.push(row)
      return chain
    }
    chain.range = () => Promise.resolve({ data: hoisted.actions, error: null })
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
    chain.upsert = (row: Record<string, unknown>) => {
      hoisted.upserts.push(row)
      return Promise.resolve({ data: null, error: hoisted.upsertError })
    }
    chain.then = (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) => {
      if (table === 'ad_daily_insights') {
        return Promise.resolve({ data: hoisted.insights, error: hoisted.insightError }).then(resolve)
      }
      if (table === 'flywheel_actions') {
        return Promise.resolve({ data: null, error: hoisted.caseError }).then(resolve)
      }
      return Promise.resolve({ data: null, error: null }).then(resolve)
    }
    return chain
  }
  return { supabaseAdmin: { from: (table: string) => chainFor(table) } }
})

const SOURCE: ReviewSource = {
  prescriptionId: 'rx-1', version: 2, goalId: 'goal-1', planId: 'plan-1', planHash: 'hash-1', approvedOn: '2026-11-01',
}
const DUE = new Date('2026-02-01T00:00:00.000Z')

function campaign(payloadExtra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'camp-1', client_id: 'client-1', flywheel: 'ads', action_type: CAMPAIGN_PAUSE_ACTION,
    payload: {
      status: 'executed', kind: 'pause', wrote: true, campaign_id: 'camp-a',
      cardRunId: 'card-camp-1', issuedAt: '2026-01-01T00:00:00.000Z',
      ...payloadExtra,
    },
    expected_metric: 'ads.account.cost_per_lead', expected_delta: null,
    executed_at: '2026-01-01T00:00:00.000Z',
    execution_item_id: null, action_run_id: 'run-camp', vendor: 'meta',
  }
}

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
  hoisted.insights = []
  hoisted.insightError = null
  hoisted.caseError = null
  hoisted.cases = []
  hoisted.filters = []
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
      metric_key: 'ads.account.cost_per_lead', verdict: 'inconclusive', confidence: 0, baseline: null, after_value: null,
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

  it('scores the same ad set over its own window and keeps the sentence', async () => {
    hoisted.actions = [budget({
      payload: {
        ...(budget().payload as object),
        beforeCents: 2000,
        afterCents: 1600,
      },
    })]
    hoisted.insights = [
      day('2025-12-28', 40, 4),
      day('2025-12-31', 30, 3),
      day('2026-01-02', 20, 5),
      day('2026-01-07', 16, 4),
      day('2026-02-01', 1, 1),
    ]
    const { runAttributionJob } = await import('../job')
    const result = await runAttributionJob({ windowDays: 14, now: DUE })
    expect(result.written).toBe(1)
    expect(hoisted.filters).toContain('ad_daily_insights.entity_id=set-a')
    expect(hoisted.filters).toContain('ad_daily_insights.level=adset')
    expect(hoisted.filters).toContain('ad_daily_insights.platform=meta')
    expect(hoisted.upserts[0]).toMatchObject({ metric_key: 'ads.account.cost_per_lead' })
    const text = caseText()
    expect(text).toContain('结论：')
    expect(text).toContain('从 20.00 调到 16.00')
    expect(text).not.toContain('set-a')
  })

  it('does not treat a pause, or a drop in spend, as an improvement', async () => {
    hoisted.actions = [budget({
      id: 'pause-1', action_type: PAUSE_CARD_ACTION, expected_metric: 'ads.account.spend', expected_delta: null,
      payload: {
        status: 'executed', source: SOURCE, before: 'ACTIVE', after: 'PAUSED',
        order: { metric: 'ads.account.spend', direction: 'pause', observationDays: 7, adsetId: 'set-a', basis: '这一组太贵' },
      },
    })]
    hoisted.insights = [day('2025-12-30', 40, 0), day('2026-01-03', 0, 0)]
    const { runAttributionJob } = await import('../job')
    expect((await runAttributionJob({ now: DUE })).written).toBe(1)
    expect(hoisted.upserts[0]).toMatchObject({ verdict: 'inconclusive', window_days: 7 })
    const text = caseText()
    expect(text).toContain('结论：')
    expect(text).not.toContain('变好了')
  })

  it('refuses an overlapping window even when the number improved', async () => {
    hoisted.actions = [
      budget(),
      budget({ id: 'budget-2', executed_at: '2026-01-04T00:00:00.000Z' }),
    ]
    hoisted.insights = [day('2025-12-28', 70, 7), day('2026-01-02', 20, 10)]
    const { runAttributionJob } = await import('../job')
    const result = await runAttributionJob({ now: DUE })
    expect(result.written).toBe(2)
    expect(hoisted.upserts.every(row => row.verdict === 'inconclusive')).toBe(true)
    expect(caseText()).toContain('还被改过')
  })

  it('reviews a campaign pause for 7 days unless the card or config names another window', async () => {
    const { runAttributionJob } = await import('../job')
    const rulesMod = await import('../review-verdict-rules')
    hoisted.actions = [campaign()]
    expect((await runAttributionJob({ now: DUE })).written).toBe(1)
    expect(hoisted.upserts[0]?.window_days).toBe(7)

    hoisted.upserts = []
    hoisted.actions = [campaign({ observationDays: 4 })]
    expect((await runAttributionJob({ now: DUE })).written).toBe(1)
    expect(hoisted.upserts[0]?.window_days).toBe(4)

    hoisted.upserts = []
    hoisted.actions = [campaign()]
    vi.mocked(rulesMod.loadClientReviewContext).mockResolvedValueOnce({
      rules: { ...rulesMod.DEFAULT_REVIEW_VERDICT_RULES, campaignPauseWindowDays: 9 },
      targetCostPerPrimary: null,
      primary: 'lead',
    })
    expect((await runAttributionJob({ now: DUE })).written).toBe(1)
    expect(hoisted.upserts[0]?.window_days).toBe(9)
  })

  it('retries a failed read or a failed case save instead of storing a guess', async () => {
    const { runAttributionJob } = await import('../job')
    hoisted.actions = [budget()]
    hoisted.insightError = { message: 'insights unavailable' }
    expect((await runAttributionJob({ now: DUE })).failed).toBe(1)
    expect(hoisted.upserts).toEqual([])

    hoisted.insightError = null
    hoisted.insights = [day('2025-12-28', 70, 7), day('2026-01-02', 36, 9)]
    hoisted.caseError = { message: 'case row rejected' }
    expect((await runAttributionJob({ now: DUE })).failed).toBe(1)
    expect(hoisted.upserts).toHaveLength(1)
    expect(hoisted.cases).toHaveLength(1)
  })
})

function day(insight_date: string, spend: number, results: number): Record<string, unknown> {
  return { insight_date, spend, results, impressions: 10, clicks: 2, leads: results, messaging_conversations: 0 }
}

function caseText(): string {
  const payload = hoisted.cases[0]?.payload as { reviewCase?: { text?: string } } | undefined
  return payload?.reviewCase?.text ?? ''
}
