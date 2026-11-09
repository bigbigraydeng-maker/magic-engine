/**
 * 回测读数必须翻过 PostgREST 的 1000 行硬顶。
 * 假表每次最多回 1000 行。3000 行里前 1000 行相关性为支持，整窗为不支持。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { runBacktest, type InsightRow } from '@/lib/agent-learning/lesson-verify/backtest'

vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: vi.fn(async () => null) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { POST } from './route'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT = 'client-backtest'
const LESSON_KEY = 'freq-cpm-up'
const POSTGREST_CAP = 1000

interface InsightCalls {
  ranges: Array<[number, number]>
  orders: Array<[string, { ascending?: boolean } | undefined]>
  limits: number[]
  filters: Array<[string, unknown]>
}

type PageBody = InsightRow[] | { error: string }

function lessonQuery() {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.maybeSingle = vi.fn(async () => ({
    data: { lesson: 'When frequency is higher, CPM rises', rationale: null },
    error: null,
  }))
  return query
}

function cappedPage(rows: InsightRow[], from: number, to: number): InsightRow[] {
  const size = Math.min(to - from + 1, POSTGREST_CAP)
  return rows.slice(from, from + size)
}

function pagePayload(body: PageBody) {
  return Array.isArray(body)
    ? { data: body, error: null }
    : { data: null, error: { message: body.error } }
}

/** 单次查询（没有 range）也只回前 1000 行，跟 PostgREST 一样静默截断。 */
function insightQuery(page: (from: number, to: number) => PageBody): { query: object; calls: InsightCalls } {
  const calls: InsightCalls = { ranges: [], orders: [], limits: [], filters: [] }
  const query = {
    select() { return query },
    eq(col: string, value: unknown) {
      calls.filters.push([col, value])
      return query
    },
    gte(col: string, value: unknown) {
      calls.filters.push([col, value])
      return query
    },
    order(col: string, opts?: { ascending?: boolean }) {
      calls.orders.push([col, opts])
      return query
    },
    limit(n: number) {
      calls.limits.push(n)
      return query
    },
    range(from: number, to: number) {
      calls.ranges.push([from, to])
      return Promise.resolve(pagePayload(page(from, to)))
    },
    then(
      resolve: (value: { data: InsightRow[] | null; error: { message: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(pagePayload(page(0, POSTGREST_CAP - 1))).then(resolve, reject)
    },
  }
  return { query, calls }
}

/** 前 1000 行频次与 CPM 同向；后面两段反向，整窗相关系数翻成不支持。 */
function flipSample(): InsightRow[] {
  return Array.from({ length: 3000 }, (_, i) => {
    const frequency = (i % POSTGREST_CAP) + 1
    return {
      frequency,
      cpm: i < POSTGREST_CAP ? frequency : POSTGREST_CAP - frequency,
      ctr: 0.02,
      impressions: 100,
    }
  })
}

function useTables(insights: object) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'global_learned_lessons') return lessonQuery() as never
    if (table === 'ad_daily_insights') return insights as never
    throw new Error(`unexpected table ${table}`)
  })
}

function postBacktest() {
  return POST(new NextRequest('http://localhost/api/admin/agent-learning/backtest', {
    method: 'POST',
    body: JSON.stringify({ lessonKey: LESSON_KEY, clientId: CLIENT }),
  }))
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('POST /api/admin/agent-learning/backtest', () => {
  it('uses the full window when the 90-day sample is over 1000 rows', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T03:00:00.000Z'))
    const sample = flipSample()
    expect(runBacktest('freq_cpm', sample.slice(0, POSTGREST_CAP)).verdict).toBe('support')
    expect(runBacktest('freq_cpm', sample).verdict).toBe('against')

    const { query, calls } = insightQuery((from, to) => cappedPage(sample, from, to))
    useTables(query)

    const response = await postBacktest()
    const body = await response.json() as { verdict?: string; summary?: string }

    expect(response.status).toBe(200)
    expect(body.verdict).toBe('against')
    expect(body.summary).toContain('过去 90 天')
    expect(body.summary).toContain('不支持')
    expect(body.summary).toContain('3000 条数据')
    expect(calls.limits).toEqual([])
    expect(calls.orders).toEqual([
      ['id', { ascending: true }],
      ['id', { ascending: true }],
      ['id', { ascending: true }],
      ['id', { ascending: true }],
    ])
    expect(calls.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]])
    expect(calls.filters).toContainEqual(['client_id', CLIENT])
    expect(calls.filters).toContainEqual(['platform', 'meta'])
    expect(calls.filters).toContainEqual(['level', 'campaign'])
    expect(calls.filters).toContainEqual(['insight_date', '2026-07-29'])
  })

  it('does not present a partial page as the 90-day verdict when a later page fails', async () => {
    const sample = flipSample()
    const { query, calls } = insightQuery((from, to) => {
      if (from > 0) return { error: 'timeout' }
      return cappedPage(sample, from, to)
    })
    useTables(query)

    const response = await postBacktest()
    const body = await response.json() as { verdict?: string; summary?: string }

    expect(response.status).toBe(500)
    expect(body.verdict).toBeUndefined()
    expect(body.summary).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('支持')
    expect(JSON.stringify(body)).not.toContain('过去 90 天')
    expect(calls.ranges.length).toBeGreaterThan(1)
    expect(runBacktest('freq_cpm', sample.slice(0, POSTGREST_CAP)).verdict).toBe('support')
  })

  it('does not present a capped sample as the 90-day verdict when paging never ends', async () => {
    const page: InsightRow[] = Array.from({ length: POSTGREST_CAP }, (_, i) => ({
      frequency: i + 1,
      cpm: i + 1,
      ctr: 0.01,
      impressions: 10,
    }))
    const { query, calls } = insightQuery(() => page)
    useTables(query)

    const response = await postBacktest()
    const body = await response.json() as { verdict?: string; summary?: string }

    expect(response.status).toBe(500)
    expect(body.verdict).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('支持')
    expect(JSON.stringify(body)).not.toContain('过去 90 天')
    expect(calls.ranges.length).toBeGreaterThan(1)
    expect(calls.ranges[1]?.[0]).toBe(POSTGREST_CAP)
  })
})
