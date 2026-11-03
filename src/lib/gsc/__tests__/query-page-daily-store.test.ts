// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('./fake-db')).fakeDb.client }))

import { supabaseAdmin } from '@/lib/supabase'
import { fakeDb } from './fake-db'
import type { GscAnalyticsRow } from '../client'
import {
  GSC_QUERY_PAGE_DAILY_CRON,
  GSC_QUERY_PAGE_DAILY_JOB,
  GSC_QUERY_PAGE_DAILY_PULL_EVENT,
  GSC_QUERY_PAGE_DAILY_PULL_JOB,
  QUERY_PAGE_BACKFILL_SEGMENTS_PER_DISPATCH,
  QUERY_PAGE_DATASET,
  QUERY_PAGE_DAILY_TABLE,
  QUERY_PAGE_RECEIPTS_TABLE,
  toQueryPageDailyRows,
  upsertQueryPageDayRows,
} from '../query-page-daily-store'
import { PAGE_DATASET } from '../page-daily-pull'
import { pullEventId } from '../page-daily-plan'
import {
  PAGE_FETCH_RECEIPTS_TABLE,
  buildPageDailyPlan,
  closeReceipt,
  closeReceiptIfRunning,
  loadPlanReceipts,
  openReceipt,
  recordFinalizedRange,
  upsertPageDayRows,
} from '../page-daily-store'

const A = 'c0000000-0000-0000-0000-000000000000'
const SITE = 'https://a.example.com/'
const DAY = '2026-09-20'

function row(query: string, pageUrl: string, clicks = 1): GscAnalyticsRow {
  return { keys: [query, pageUrl], clicks, impressions: clicks * 10, ctr: 0.1, position: 3.5 }
}

function receiptRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    client_id: A,
    site_url: SITE,
    kind: 'backfill',
    request_start_day: '2026-08-01',
    request_end_day: '2026-08-31',
    data_from_day: null,
    data_through_day: '2026-08-31',
    status: 'complete',
    failure_kind: null,
    row_count: 0,
    request_count: 0,
    skipped_long_urls: 0,
    inngest_run_id: 'run-x',
    inngest_event_id: null,
    error: null,
    started_at: '2026-09-25T18:31:00Z',
    finished_at: '2026-09-25T18:40:00Z',
    ...over,
  }
}

beforeEach(() => {
  fakeDb.reset()
  vi.restoreAllMocks()
})

describe('toQueryPageDailyRows', () => {
  it('stores query and page_url exactly as given, with no case folding', () => {
    const rows: GscAnalyticsRow[] = [
      row('Foo', 'https://www.example.com/a'),
      row('foo', 'https://www.example.com/a'),
    ]

    const result = toQueryPageDailyRows(A, DAY, rows)

    expect(result.rows).toHaveLength(2)
    expect(result.rows.map((r) => r.query).sort()).toEqual(['Foo', 'foo'])
    expect(result.rows.every((r) => r.page_url === 'https://www.example.com/a')).toBe(true)
    expect(result.skippedLongUrls).toBe(0)
  })

  it('derives page_key from gscPageKey and rounds clicks and impressions', () => {
    const rows: GscAnalyticsRow[] = [
      { keys: ['widgets', 'https://www.example.com/p/1/?utm_source=x'], clicks: 2.6, impressions: 30.4, ctr: 0.05, position: 7.25 },
    ]

    const result = toQueryPageDailyRows(A, DAY, rows)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].query).toBe('widgets')
    expect(result.rows[0].page_url).toBe('https://www.example.com/p/1/?utm_source=x')
    expect(result.rows[0].page_key).toBe('example.com/p/1')
    expect(result.rows[0].clicks).toBe(3)
    expect(result.rows[0].impressions).toBe(30)
  })

  it('keeps one row per (query, page_url) pair, the later one winning', () => {
    const rows: GscAnalyticsRow[] = [
      row('widgets', 'https://www.example.com/a', 1),
      row('widgets', 'https://www.example.com/a', 9),
    ]

    const result = toQueryPageDailyRows(A, DAY, rows)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].clicks).toBe(9)
  })

  it('skips rows with an empty query or an empty page silently', () => {
    const rows: GscAnalyticsRow[] = [
      row('', 'https://www.example.com/a'),
      row('widgets', ''),
      row('widgets', 'https://www.example.com/a'),
    ]

    const result = toQueryPageDailyRows(A, DAY, rows)

    expect(result.rows).toHaveLength(1)
    expect(result.skippedLongUrls).toBe(0)
  })

  it('counts a query + page_url over 2000 UTF-8 bytes as skipped and does not return it', () => {
    const longQuery = '中'.repeat(700) // 2100 UTF-8 bytes
    const rows: GscAnalyticsRow[] = [
      row(longQuery, 'https://www.example.com/a'),
      row('widgets', 'https://www.example.com/a'),
    ]

    const result = toQueryPageDailyRows(A, DAY, rows)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].query).toBe('widgets')
    expect(result.skippedLongUrls).toBe(1)
  })

  it('counts a page_key over 2000 UTF-8 bytes as skipped', () => {
    const longPath = 'a'.repeat(2100)
    const rows: GscAnalyticsRow[] = [
      row('widgets', `https://example.com/${longPath}`),
      row('widgets', 'https://www.example.com/a'),
    ]

    const result = toQueryPageDailyRows(A, DAY, rows)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].page_url).toBe('https://www.example.com/a')
    expect(result.skippedLongUrls).toBe(1)
  })
})

describe('upsertQueryPageDayRows', () => {
  it('writes into gsc_query_page_daily with the (client_id, day, query, page_url) conflict key', async () => {
    const input = [
      row('widgets', 'https://www.example.com/a', 1),
      row('gadgets', 'https://www.example.com/b', 2),
    ]

    const result = await upsertQueryPageDayRows(supabaseAdmin, A, DAY, input)

    expect(result).toEqual({ written: 2, skippedLongUrls: 0 })
    const stored = fakeDb.tables[QUERY_PAGE_DAILY_TABLE]
    expect(stored).toHaveLength(2)
    expect(stored.every((r) => r.client_id === A && r.day === DAY)).toBe(true)
  })

  it('re-running with changed clicks updates the same row and leaves the row count unchanged', async () => {
    await upsertQueryPageDayRows(supabaseAdmin, A, DAY, [row('widgets', 'https://www.example.com/a', 1)])
    await upsertQueryPageDayRows(supabaseAdmin, A, DAY, [row('widgets', 'https://www.example.com/a', 7)])

    const stored = fakeDb.tables[QUERY_PAGE_DAILY_TABLE]
    expect(stored).toHaveLength(1)
    expect(stored[0].clicks).toBe(7)
  })

  it('writes 1200 rows in batches', async () => {
    const input: GscAnalyticsRow[] = []
    for (let i = 0; i < 1200; i += 1) {
      input.push(row(`q-${i}`, `https://www.example.com/p/${i}`))
    }

    const result = await upsertQueryPageDayRows(supabaseAdmin, A, DAY, input)

    expect(result.written).toBe(1200)
    expect(fakeDb.tables[QUERY_PAGE_DAILY_TABLE]).toHaveLength(1200)
    expect(fakeDb.calls.filter((c) => c.startsWith(`upsert ${QUERY_PAGE_DAILY_TABLE}`))).toEqual([
      `upsert ${QUERY_PAGE_DAILY_TABLE} 500`,
      `upsert ${QUERY_PAGE_DAILY_TABLE} 500`,
      `upsert ${QUERY_PAGE_DAILY_TABLE} 200`,
    ])
  })

  it('a failed write throws and is never counted as written', async () => {
    fakeDb.fail({ table: QUERY_PAGE_DAILY_TABLE, op: 'upsert', message: 'deadlock detected', times: 1 })

    await expect(
      upsertQueryPageDayRows(supabaseAdmin, A, DAY, [row('widgets', 'https://www.example.com/a')]),
    ).rejects.toThrow(/gsc_query_page_daily/)
  })
})

describe('QUERY_PAGE_DATASET and constants', () => {
  it('describes the (query, page) data set', () => {
    expect(QUERY_PAGE_DATASET.dimensions).toEqual(['query', 'page'])
    expect(QUERY_PAGE_DATASET.receiptsTable).toBe('gsc_query_page_fetch_receipts')
    expect(QUERY_PAGE_DATASET.pullJob).toBe('gsc-query-page-daily-pull')
  })

  it('exposes the chain constants', () => {
    expect(GSC_QUERY_PAGE_DAILY_JOB).toBe('gsc-query-page-daily')
    expect(GSC_QUERY_PAGE_DAILY_PULL_EVENT).toBe('gsc/query-page-daily.pull.due')
    expect(GSC_QUERY_PAGE_DAILY_CRON).toBe('0 19 * * *')
    expect(QUERY_PAGE_BACKFILL_SEGMENTS_PER_DISPATCH).toBe(4)
    expect(GSC_QUERY_PAGE_DAILY_PULL_JOB).toBe('gsc-query-page-daily-pull')
    expect(QUERY_PAGE_DAILY_TABLE).toBe('gsc_query_page_daily')
    expect(QUERY_PAGE_RECEIPTS_TABLE).toBe('gsc_query_page_fetch_receipts')
  })
})

describe('PAGE_DATASET golden', () => {
  it('describes the per-page data set', () => {
    expect(PAGE_DATASET.dimensions).toEqual(['page'])
    expect(PAGE_DATASET.pullJob).toBe('gsc-page-daily-pull')
    expect(PAGE_DATASET.receiptsTable).toBe('gsc_page_fetch_receipts')
    expect(PAGE_DATASET.upsertDay).toBe(upsertPageDayRows)
  })

  it('pullEventId builds the per-page event id, and honours a prefix', () => {
    const order = { client_id: 'x', kind: 'daily' as const, start_day: '2026-01-01', end_day: '2026-01-05' }
    expect(pullEventId(order)).toBe('gsc-page-daily:x:daily:2026-01-01:2026-01-05')
    expect(pullEventId(order, 'gsc-query-page-daily').startsWith('gsc-query-page-daily:')).toBe(true)
  })
})

describe('receipt functions with an explicit table', () => {
  const input = {
    id: 'r-1',
    client_id: A,
    site_url: SITE,
    kind: 'daily' as const,
    request_start_day: '2026-09-21',
    request_end_day: '2026-09-25',
    inngest_run_id: 'run-1',
    inngest_event_id: 'evt-1',
    started_at: '2026-09-26T18:30:05Z',
  }

  it('openReceipt / recordFinalizedRange / closeReceipt write only the given table', async () => {
    await openReceipt(supabaseAdmin, input, QUERY_PAGE_RECEIPTS_TABLE)
    await recordFinalizedRange(supabaseAdmin, 'r-1', { firstDay: '2026-09-21', lastDay: '2026-09-23' }, QUERY_PAGE_RECEIPTS_TABLE)
    await closeReceipt(
      supabaseAdmin,
      'r-1',
      { status: 'complete', failure_kind: null, row_count: 5, request_count: 2, skipped_long_urls: 0, error: null },
      new Date('2026-09-26T18:35:00Z'),
      QUERY_PAGE_RECEIPTS_TABLE,
    )

    const stored = fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE]
    expect(stored).toHaveLength(1)
    expect(stored[0].status).toBe('complete')
    expect(stored[0].data_from_day).toBe('2026-09-21')
    expect(stored[0].data_through_day).toBe('2026-09-23')
    expect(stored[0].row_count).toBe(5)
    expect(fakeDb.tables[PAGE_FETCH_RECEIPTS_TABLE] ?? []).toHaveLength(0)
  })

  it('closeReceiptIfRunning closes only the given table', async () => {
    fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE] = [
      receiptRow({ id: 'x1', status: 'running', finished_at: null, started_at: '2026-09-26T18:30:00Z' }),
    ]

    const closed = await closeReceiptIfRunning(
      supabaseAdmin,
      'x1',
      { failure_kind: 'quota', error: 'retries exhausted' },
      new Date('2026-09-26T19:00:00Z'),
      QUERY_PAGE_RECEIPTS_TABLE,
    )

    expect(closed).toEqual({ started_at: '2026-09-26T18:30:00Z' })
    expect(fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE][0].status).toBe('failed')
    expect(fakeDb.tables[PAGE_FETCH_RECEIPTS_TABLE] ?? []).toHaveLength(0)
  })

  it('loadPlanReceipts reads only the given table', async () => {
    fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE] = [receiptRow({ id: 'q-1' })]
    fakeDb.tables[PAGE_FETCH_RECEIPTS_TABLE] = [receiptRow({ id: 'p-1' })]

    const receipts = await loadPlanReceipts(supabaseAdmin, [A], '2025-06-01', QUERY_PAGE_RECEIPTS_TABLE)

    expect(receipts).toHaveLength(1)
    expect(fakeDb.calls.some((c) => c.startsWith(`select ${QUERY_PAGE_RECEIPTS_TABLE}`))).toBe(true)
    expect(fakeDb.calls.some((c) => c.startsWith(`select ${PAGE_FETCH_RECEIPTS_TABLE}`))).toBe(false)
  })

  it('without the table argument the page receipts table is used', async () => {
    await openReceipt(supabaseAdmin, input)

    expect(fakeDb.tables[PAGE_FETCH_RECEIPTS_TABLE]).toHaveLength(1)
    expect(fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE] ?? []).toHaveLength(0)
  })
})

describe('buildPageDailyPlan with query-page options', () => {
  it('dispatches 1 daily + 4 backfill orders with maxBackfillSegments 4', async () => {
    fakeDb.tables.client_connectors = [
      { client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: SITE } },
    ]

    const plan = await buildPageDailyPlan(supabaseAdmin, '2026-09-26', {
      receiptsTable: QUERY_PAGE_RECEIPTS_TABLE,
      maxBackfillSegments: 4,
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok plan')
    expect(plan.clients).toBe(1)
    expect(plan.orders.filter((o) => o.kind === 'daily')).toHaveLength(1)
    expect(plan.orders.filter((o) => o.kind === 'backfill')).toHaveLength(4)
  })

  it('without options dispatches 1 daily + 3 backfill orders', async () => {
    fakeDb.tables.client_connectors = [
      { client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: SITE } },
    ]

    const plan = await buildPageDailyPlan(supabaseAdmin, '2026-09-26')

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok plan')
    expect(plan.orders.filter((o) => o.kind === 'daily')).toHaveLength(1)
    expect(plan.orders.filter((o) => o.kind === 'backfill')).toHaveLength(3)
  })

  it('page receipts do not count as coverage for the query-page plan', async () => {
    fakeDb.tables.client_connectors = [
      { client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: SITE } },
    ]
    // A complete page receipt covering last month — must not cover the query-page plan.
    fakeDb.tables[PAGE_FETCH_RECEIPTS_TABLE] = [
      receiptRow({ request_start_day: '2026-08-01', request_end_day: '2026-08-31', data_through_day: '2026-08-31' }),
    ]

    const plan = await buildPageDailyPlan(supabaseAdmin, '2026-09-26', {
      receiptsTable: QUERY_PAGE_RECEIPTS_TABLE,
      maxBackfillSegments: 4,
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok plan')
    expect(plan.orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-08-01')).toBe(true)
  })
})
