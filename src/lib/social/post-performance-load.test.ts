// Draft tests for the read-only post-performance loader.
//
// A tiny fake Supabase client is built inline. It records every chained call
// per table and resolves to a per-table { data, error } config. The fake is a
// plain object; the single `fake as never` cast is the only cast in this file.

import { describe, it, expect } from 'vitest'
import {
  loadPostPerformance,
  DEFAULT_POST_PERFORMANCE_LIMIT,
} from './post-performance-load'

const CLIENT = 'client-1'
const SINCE = new Date('2024-01-01T00:00:00.000Z')
const UNTIL = new Date('2024-01-31T23:59:59.000Z')

type Method =
  | 'select'
  | 'eq'
  | 'gte'
  | 'lte'
  | 'in'
  | 'like'
  | 'order'
  | 'limit'

interface Call {
  method: Method
  args: unknown[]
}

interface TableConfig {
  data: unknown
  error: { message: string } | null
}

interface FakeQuery {
  calls: Call[]
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

interface FakeClient {
  callsByTable: Record<string, Call[]>
  from: (table: string) => FakeQuery
}

function makeFakeClient(config: Record<string, TableConfig>): FakeClient {
  const callsByTable: Record<string, Call[]> = {}

  const from = (table: string): FakeQuery => {
    const calls: Call[] = []
    callsByTable[table] = calls

    const query: FakeQuery = {
      calls,
      select: (...args) => {
        calls.push({ method: 'select', args })
        return query
      },
      eq: (...args) => {
        calls.push({ method: 'eq', args })
        return query
      },
      gte: (...args) => {
        calls.push({ method: 'gte', args })
        return query
      },
      lte: (...args) => {
        calls.push({ method: 'lte', args })
        return query
      },
      in: (...args) => {
        calls.push({ method: 'in', args })
        return query
      },
      like: (...args) => {
        calls.push({ method: 'like', args })
        return query
      },
      order: (...args) => {
        calls.push({ method: 'order', args })
        return query
      },
      limit: (...args) => {
        calls.push({ method: 'limit', args })
        return query
      },
      then: (resolve) => {
        const cfg = config[table] ?? { data: [], error: null }
        resolve({ data: cfg.data, error: cfg.error })
      },
    }

    return query
  }

  return { callsByTable, from }
}

function hasCall(calls: Call[], method: Method, ...expected: unknown[]): boolean {
  return calls.some(
    (c) =>
      c.method === method &&
      expected.every((v, i) => c.args[i] === v),
  )
}

describe('loadPostPerformance', () => {
  it('happy path: builds a facebook block with posts, stories and page-level metrics', async () => {
    const fake = makeFakeClient({
      flywheel_actions: {
        data: [
          {
            id: 'a1',
            executed_at: '2024-01-10T10:00:00.000Z',
            payload: {
              platform: 'facebook',
              source: 'daily_plan',
              post_id: 'p1',
            },
          },
        ],
        error: null,
      },
      social_post_measurement_receipts: {
        data: [
          {
            action_id: 'a1',
            window_hours: 24,
            status: 'ok',
            measured_at: '2024-01-11T10:00:00.000Z',
            values: { likes: 0, comments: 2 },
            missing: null,
            reason: null,
          },
        ],
        error: null,
      },
      story_items: {
        data: [
          {
            item_id: 's1',
            channel: 'facebook_story',
            status: 'SENT',
            sent_at: '2024-01-12T10:00:00.000Z',
            slot_at: '2024-01-12T10:00:00.000Z',
          },
        ],
        error: null,
      },
      flywheel_metrics: {
        data: [
          {
            metric_key: 'social.fb.posts_7d',
            metric_value: 3,
            measured_at: '2024-01-13T10:00:00.000Z',
          },
        ],
        error: null,
      },
    })

    const report = await loadPostPerformance(fake as never, {
      clientId: CLIENT,
      since: SINCE,
      until: UNTIL,
    })

    const fb = report.platforms.find((p) => p.platform === 'facebook')
    expect(fb).toBeDefined()
    if (fb === undefined) return

    expect(fb.posts.n).toBe(1)
    expect(fb.posts.metrics.likes.sum).toEqual({ kind: 'value', value: 0 })
    expect(fb.stories.n).toBe(1)

    const posts7d = fb.page_level.find((e) => e.metric_key === 'social.fb.posts_7d')
    expect(posts7d).toBeDefined()
    expect(posts7d?.reading).toEqual({ kind: 'value', value: 3 })
  })

  it('applies the expected filters on every table', async () => {
    const fake = makeFakeClient({
      flywheel_actions: { data: [], error: null },
      story_items: { data: [], error: null },
      flywheel_metrics: { data: [], error: null },
    })

    await loadPostPerformance(fake as never, {
      clientId: CLIENT,
      since: SINCE,
      until: UNTIL,
    })

    for (const table of ['flywheel_actions', 'story_items', 'flywheel_metrics']) {
      const calls = fake.callsByTable[table] ?? []
      expect(hasCall(calls, 'eq', 'client_id', CLIENT)).toBe(true)
    }

    const actionCalls = fake.callsByTable['flywheel_actions'] ?? []
    expect(hasCall(actionCalls, 'eq', 'action_type', 'social.publish_post')).toBe(true)

    const storyCalls = fake.callsByTable['story_items'] ?? []
    expect(hasCall(storyCalls, 'eq', 'status', 'SENT')).toBe(true)

    const metricCalls = fake.callsByTable['flywheel_metrics'] ?? []
    expect(hasCall(metricCalls, 'like', 'metric_key', 'social.fb.%')).toBe(true)
  })

  it('does not query receipts when there are no actions, and still returns six platform blocks', async () => {
    const fake = makeFakeClient({
      flywheel_actions: { data: [], error: null },
      story_items: { data: [], error: null },
      flywheel_metrics: { data: [], error: null },
    })

    const report = await loadPostPerformance(fake as never, {
      clientId: CLIENT,
      since: SINCE,
      until: UNTIL,
    })

    expect(fake.callsByTable['social_post_measurement_receipts']).toBeUndefined()
    expect(report.platforms).toHaveLength(6)
  })

  it.each([
    ['flywheel_actions'],
    ['social_post_measurement_receipts'],
    ['story_items'],
    ['flywheel_metrics'],
  ])('rejects with the table name when %s errors', async (table) => {
    const base: Record<string, TableConfig> = {
      flywheel_actions: {
        data: [
          {
            id: 'a1',
            executed_at: '2024-01-10T10:00:00.000Z',
            payload: { platform: 'facebook', source: 'daily_plan', post_id: 'p1' },
          },
        ],
        error: null,
      },
      social_post_measurement_receipts: { data: [], error: null },
      story_items: { data: [], error: null },
      flywheel_metrics: { data: [], error: null },
    }
    base[table] = { data: [], error: { message: 'boom' } }

    const fake = makeFakeClient(base)

    await expect(
      loadPostPerformance(fake as never, {
        clientId: CLIENT,
        since: SINCE,
        until: UNTIL,
      }),
    ).rejects.toThrow(table)
  })

  it('never writes: no insert/update/upsert/delete calls are recorded', async () => {
    const fake = makeFakeClient({
      flywheel_actions: { data: [], error: null },
      story_items: { data: [], error: null },
      flywheel_metrics: { data: [], error: null },
    })

    await loadPostPerformance(fake as never, {
      clientId: CLIENT,
      since: SINCE,
      until: UNTIL,
    })

    const forbidden = new Set(['insert', 'update', 'upsert', 'delete'])
    for (const calls of Object.values(fake.callsByTable)) {
      for (const call of calls) {
        expect(forbidden.has(call.method)).toBe(false)
      }
    }
  })

  it('uses the default limit of 20 when none is provided', async () => {
    const fake = makeFakeClient({
      flywheel_actions: { data: [], error: null },
      story_items: { data: [], error: null },
      flywheel_metrics: { data: [], error: null },
    })

    const report = await loadPostPerformance(fake as never, {
      clientId: CLIENT,
      since: SINCE,
      until: UNTIL,
    })

    expect(report.limit).toBe(DEFAULT_POST_PERFORMANCE_LIMIT)
    expect(report.limit).toBe(20)
  })

  it('passes a custom limit through to the report', async () => {
    const fake = makeFakeClient({
      flywheel_actions: { data: [], error: null },
      story_items: { data: [], error: null },
      flywheel_metrics: { data: [], error: null },
    })

    const report = await loadPostPerformance(fake as never, {
      clientId: CLIENT,
      since: SINCE,
      until: UNTIL,
      limit: 5,
    })

    expect(report.limit).toBe(5)
  })
})
