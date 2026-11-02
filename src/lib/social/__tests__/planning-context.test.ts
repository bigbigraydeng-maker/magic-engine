import { describe, it, expect } from 'vitest'

import {
  UNREADABLE_DISPLAY,
  MAX_ACTION_ROWS,
  MAX_PAGE_METRIC_ROWS,
  assertNoError,
  buildPageRollupSnapshot,
  buildSocialPlanningContextFromRows,
  buildT72PostSnapshots,
  loadSocialPlanningContext,
  readingToDisplay,
  summarizeTuneSuggestions,
  type PlanningContextRows,
} from '../planning-context'
import type { PublishActionRow, ReceiptRow, PageMetricRow } from '../post-performance'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CAMPAIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const WINDOW_SINCE = '2026-10-20T00:00:00.000Z'
const WINDOW_UNTIL = '2026-10-27T00:00:00.000Z'
const GENERATED = '2026-10-27T12:00:00.000Z'

function baseRows(overrides: Partial<PlanningContextRows> = {}): PlanningContextRows {
  return {
    clientId: CLIENT,
    campaignId: CAMPAIGN,
    since: WINDOW_SINCE,
    until: WINDOW_UNTIL,
    generatedAt: GENERATED,
    windowActions: [],
    receipts: [],
    pageMetrics: [],
    tuneActions: [],
    tuneReceipts: [],
    ...overrides,
  }
}

describe('readingToDisplay', () => {
  it('maps unreadable readings to 没读到', () => {
    expect(readingToDisplay({ kind: 'not_readable', reason: 'no_receipt' }).display).toBe(UNREADABLE_DISPLAY)
  })

  it('keeps numeric zero as a value display', () => {
    expect(readingToDisplay({ kind: 'value', value: 0 }).display).toBe('0')
    expect(readingToDisplay({ kind: 'value', value: 0 }).kind).toBe('value')
  })
})

describe('buildSocialPlanningContextFromRows — normal week', () => {
  const actionWithT72: PublishActionRow = {
    id: 'act-1',
    executed_at: '2026-10-22T08:00:00.000Z',
    payload: {
      source: 'daily_plan',
      idempotency_key: 'post-a',
      published_at: '2026-10-22T08:00:00.000Z',
      campaign_id: CAMPAIGN,
    },
  }

  const actionPending: PublishActionRow = {
    id: 'act-2',
    executed_at: '2026-10-24T08:00:00.000Z',
    payload: {
      source: 'daily_plan',
      idempotency_key: 'post-b',
      published_at: '2026-10-24T08:00:00.000Z',
      campaign_id: CAMPAIGN,
    },
  }

  const receipts: ReceiptRow[] = [
    {
      action_id: 'act-1',
      window_hours: 72,
      status: 'partial',
      measured_at: '2026-10-25T08:00:00.000Z',
      values: { likes: 3, comments: 1 },
      missing: { shares: 'omitted_unverified' },
      reason: null,
    },
    {
      action_id: 'act-1',
      window_hours: 4,
      status: 'ok',
      measured_at: '2026-10-22T12:00:00.000Z',
      values: { likes: 1, comments: 0, shares: 0 },
      missing: {},
      reason: null,
    },
  ]

  const pageMetrics: PageMetricRow[] = [
    {
      metric_key: 'social.fb.posts_7d',
      metric_value: 4,
      measured_at: '2026-10-27T04:00:00.000Z',
    },
    {
      metric_key: 'social.fb.reactions_7d',
      metric_value: 12,
      measured_at: '2026-10-27T04:00:00.000Z',
    },
  ]

  it('aggregates T+72 rows, tune counts, and page rollup', () => {
    const ctx = buildSocialPlanningContextFromRows(
      baseRows({
        windowActions: [actionWithT72, actionPending],
        receipts,
        pageMetrics,
        tuneActions: [
          { id: 'act-1', idempotencyKey: 'post-a' },
          { id: 'act-3', idempotencyKey: 'post-c' },
          { id: 'act-4', idempotencyKey: 'post-d' },
          { id: 'act-5', idempotencyKey: 'post-e' },
        ],
        tuneReceipts: [
          { actionId: 'act-1', windowHours: 72, status: 'ok', values: { likes: 20, comments: 1 }, missing: {} },
          { actionId: 'act-3', windowHours: 72, status: 'ok', values: { likes: 10, comments: 1 }, missing: {} },
          { actionId: 'act-4', windowHours: 72, status: 'ok', values: { likes: 10, comments: 1 }, missing: {} },
          { actionId: 'act-5', windowHours: 72, status: 'ok', values: { likes: 10, comments: 1 }, missing: {} },
        ],
      }),
    )

    expect(ctx.client_id).toBe(CLIENT)
    expect(ctx.t72.publish_action_count).toBe(2)
    expect(ctx.t72.with_t72_receipt_count).toBe(1)

    const rowA = ctx.t72.posts.find((p) => p.idempotency_key === 'post-a')
    expect(rowA?.likes).toEqual({ display: '3', kind: 'value' })
    expect(rowA?.shares.display).toBe(UNREADABLE_DISPLAY)

    const rowB = ctx.t72.posts.find((p) => p.idempotency_key === 'post-b')
    expect(rowB?.likes.display).toBe(UNREADABLE_DISPLAY)

    expect(ctx.page_rollup.metrics.posts_7d.display).toBe('4')
    expect(ctx.page_rollup.measured_at).toBe('2026-10-27T04:00:00.000Z')

    expect(ctx.tune.available).toBe(true)
    expect(ctx.tune.by_idempotency_key['post-a']?.decision).toBe('REPEAT')
    expect(ctx.tune.counts.pending_t72).toBe(0)
  })
})

describe('buildSocialPlanningContextFromRows — missing data never fakes zero', () => {
  it('uses 没读到 for absent receipts and rollup fields', () => {
    const { posts } = buildT72PostSnapshots(
      [
        {
          id: 'act-x',
          executed_at: '2026-10-21T08:00:00.000Z',
          payload: { source: 'daily_plan', idempotency_key: 'x' },
        },
      ],
      new Map(),
    )
    expect(posts[0].likes.display).toBe(UNREADABLE_DISPLAY)
    expect(posts[0].comments.display).toBe(UNREADABLE_DISPLAY)
    expect(posts[0].shares.display).toBe(UNREADABLE_DISPLAY)

    const rollup = buildPageRollupSnapshot([])
    expect(rollup.measured_at).toBeNull()
    expect(rollup.metrics.posts_7d.display).toBe(UNREADABLE_DISPLAY)
    expect(rollup.metrics.shares_7d.display).toBe(UNREADABLE_DISPLAY)

    const tune = summarizeTuneSuggestions({ key1: null })
    expect(tune.by_idempotency_key.key1.display).toBe(UNREADABLE_DISPLAY)
    expect(tune.counts.pending_t72).toBe(1)
  })
})

describe('buildSocialPlanningContextFromRows — empty client', () => {
  it('returns empty collections with unreadable rollup and tune unavailable without campaign', () => {
    const ctx = buildSocialPlanningContextFromRows(
      baseRows({ clientId: CLIENT, campaignId: null, windowActions: [], pageMetrics: [] }),
    )

    expect(ctx.t72.publish_action_count).toBe(0)
    expect(ctx.t72.with_t72_receipt_count).toBe(0)
    expect(ctx.t72.posts).toEqual([])
    expect(ctx.tune.available).toBe(false)
    expect(ctx.tune.counts).toEqual({
      REPEAT: 0,
      ITERATE: 0,
      STOP: 0,
      INCONCLUSIVE: 0,
      pending_t72: 0,
    })
    expect(ctx.page_rollup.metrics.posts_7d.display).toBe(UNREADABLE_DISPLAY)
    expect(ctx.page_rollup.metrics.reactions_7d.display).toBe(UNREADABLE_DISPLAY)
    expect(ctx.truncated).toEqual({ window_actions: false, page_metrics: false })
  })
})

describe('buildSocialPlanningContextFromRows — measured zero through aggregation', () => {
  it('T+72 receipt zeros and posts_7d zero stay kind value; shares_7d stays unreadable', () => {
    const ctx = buildSocialPlanningContextFromRows(
      baseRows({
        windowActions: [
          {
            id: 'act-zero',
            executed_at: '2026-10-22T08:00:00.000Z',
            payload: {
              source: 'daily_plan',
              idempotency_key: 'post-zero',
              published_at: '2026-10-22T08:00:00.000Z',
            },
          },
        ],
        receipts: [
          {
            action_id: 'act-zero',
            window_hours: 72,
            status: 'ok',
            measured_at: '2026-10-25T08:00:00.000Z',
            values: { likes: 0, comments: 0, shares: 0 },
            missing: {},
            reason: null,
          },
        ],
        pageMetrics: [
          {
            metric_key: 'social.fb.posts_7d',
            metric_value: 0,
            measured_at: '2026-10-27T04:00:00.000Z',
          },
          {
            metric_key: 'social.fb.shares_7d',
            metric_value: 0,
            measured_at: '2026-10-27T04:00:00.000Z',
          },
        ],
      }),
    )

    const row = ctx.t72.posts[0]
    expect(row.likes).toEqual({ display: '0', kind: 'value' })
    expect(row.comments).toEqual({ display: '0', kind: 'value' })
    expect(row.shares).toEqual({ display: '0', kind: 'value' })

    expect(ctx.page_rollup.metrics.posts_7d).toEqual({ display: '0', kind: 'value' })
    expect(ctx.page_rollup.metrics.shares_7d.display).toBe(UNREADABLE_DISPLAY)
    expect(ctx.page_rollup.metrics.shares_7d.kind).toBe('unreadable')
  })
})

describe('assertNoError', () => {
  it('throws with table name when error is set', () => {
    expect(() => assertNoError('flywheel_actions', { message: 'connection reset' })).toThrow(
      'loadSocialPlanningContext: flywheel_actions — connection reset',
    )
  })
})

describe('loadSocialPlanningContext', () => {
  interface FakeQuery {
    select: (...args: unknown[]) => FakeQuery
    eq: (...args: unknown[]) => FakeQuery
    gte: (...args: unknown[]) => FakeQuery
    lte: (...args: unknown[]) => FakeQuery
    in: (...args: unknown[]) => FakeQuery
    like: (...args: unknown[]) => FakeQuery
    order: (...args: unknown[]) => FakeQuery
    limit: (...args: unknown[]) => FakeQuery
    then: (
      resolve: (value: { data: unknown; error: { message: string } | null }) => void,
    ) => void
  }

  type TableResult = { data: unknown; error: { message: string } | null }

  function makeFake(config: Record<string, TableResult>): { from: (t: string) => FakeQuery } {
    return {
      from: (table: string) => {
        const row = config[table] ?? { data: [], error: null }
        const query: FakeQuery = {
          select: () => query,
          eq: () => query,
          gte: () => query,
          lte: () => query,
          in: () => query,
          like: () => query,
          order: () => query,
          limit: () => query,
          then: (resolve) => resolve(row),
        }
        return query
      },
    }
  }

  function makeSequentialFlywheelActionsFake(
    windowData: unknown,
    tuneData: unknown,
    other: Record<string, TableResult> = {},
  ): { from: (t: string) => FakeQuery } {
    let flywheelCalls = 0
    return {
      from: (table: string) => {
        const row: TableResult =
          table === 'flywheel_actions'
            ? { data: ++flywheelCalls === 1 ? windowData : tuneData, error: null }
            : (other[table] ?? { data: [], error: null })
        const query: FakeQuery = {
          select: () => query,
          eq: () => query,
          gte: () => query,
          lte: () => query,
          in: () => query,
          like: () => query,
          order: () => query,
          limit: () => query,
          then: (resolve) => resolve(row),
        }
        return query
      },
    }
  }

  it('loads through Supabase stubs without throwing', async () => {
    const ctx = await loadSocialPlanningContext(makeFake({}) as never, {
      clientId: CLIENT,
      since: new Date(WINDOW_SINCE),
      until: new Date(WINDOW_UNTIL),
      now: new Date(GENERATED),
    })

    expect(ctx.client_id).toBe(CLIENT)
    expect(ctx.t72.posts).toEqual([])
    expect(ctx.page_rollup.metrics.top_post_score.display).toBe(UNREADABLE_DISPLAY)
    expect(ctx.truncated).toEqual({ window_actions: false, page_metrics: false })
  })

  it('throws when the first flywheel_actions query errors', async () => {
    await expect(
      loadSocialPlanningContext(
        makeFake({
          flywheel_actions: { data: null, error: { message: 'timeout' } },
        }) as never,
        {
          clientId: CLIENT,
          since: new Date(WINDOW_SINCE),
          until: new Date(WINDOW_UNTIL),
        },
      ),
    ).rejects.toThrow('loadSocialPlanningContext: flywheel_actions — timeout')
  })

  it('runs the campaignId tune branch and evaluates suggestions', async () => {
    const supabase = makeSequentialFlywheelActionsFake(
      [
        {
          id: 'win-1',
          executed_at: '2026-10-22T08:00:00.000Z',
          payload: { source: 'daily_plan', idempotency_key: 'win-post' },
        },
      ],
      [
        {
          id: 'tune-1',
          payload: {
            source: 'daily_plan',
            idempotency_key: 't1',
            campaign_id: CAMPAIGN,
          },
        },
        {
          id: 'tune-2',
          payload: {
            source: 'daily_plan',
            idempotency_key: 't2',
            campaign_id: CAMPAIGN,
          },
        },
        {
          id: 'tune-3',
          payload: {
            source: 'daily_plan',
            idempotency_key: 't3',
            campaign_id: CAMPAIGN,
          },
        },
        {
          id: 'tune-4',
          payload: {
            source: 'daily_plan',
            idempotency_key: 't4',
            campaign_id: CAMPAIGN,
          },
        },
      ],
      {
        flywheel_metrics: { data: [], error: null },
        social_post_measurement_receipts: {
          data: [
            {
              action_id: 'win-1',
              window_hours: 72,
              status: 'ok',
              measured_at: '2026-10-25T08:00:00.000Z',
              values: { likes: 1 },
              missing: {},
              reason: null,
            },
            { action_id: 'tune-1', window_hours: 72, status: 'ok', values: { likes: 20, comments: 1 }, missing: {} },
            { action_id: 'tune-2', window_hours: 72, status: 'ok', values: { likes: 10, comments: 1 }, missing: {} },
            { action_id: 'tune-3', window_hours: 72, status: 'ok', values: { likes: 10, comments: 1 }, missing: {} },
            { action_id: 'tune-4', window_hours: 72, status: 'ok', values: { likes: 10, comments: 1 }, missing: {} },
          ],
          error: null,
        },
      },
    )

    const ctx = await loadSocialPlanningContext(supabase as never, {
      clientId: CLIENT,
      campaignId: CAMPAIGN,
      since: new Date(WINDOW_SINCE),
      until: new Date(WINDOW_UNTIL),
    })

    expect(ctx.tune.available).toBe(true)
    expect(ctx.tune.by_idempotency_key.t1?.decision).toBe('REPEAT')
    expect(ctx.t72.with_t72_receipt_count).toBe(1)
  })

  it('sets truncated when row caps are hit', async () => {
    const windowActions = Array.from({ length: MAX_ACTION_ROWS }, (_, i) => ({
      id: `act-${i}`,
      executed_at: '2026-10-22T08:00:00.000Z',
      payload: { source: 'daily_plan', idempotency_key: `p-${i}` },
    }))
    const pageMetrics = Array.from({ length: MAX_PAGE_METRIC_ROWS }, (_, i) => ({
      metric_key: 'social.fb.posts_7d',
      metric_value: i,
      measured_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
    }))

    const ctx = await loadSocialPlanningContext(
      makeFake({
        flywheel_actions: { data: windowActions, error: null },
        flywheel_metrics: { data: pageMetrics, error: null },
        social_post_measurement_receipts: { data: [], error: null },
      }) as never,
      {
        clientId: CLIENT,
        since: new Date(WINDOW_SINCE),
        until: new Date(WINDOW_UNTIL),
      },
    )

    expect(ctx.truncated).toEqual({ window_actions: true, page_metrics: true })
  })
})
