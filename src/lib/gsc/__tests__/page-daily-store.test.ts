// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('./fake-db')).fakeDb.client }))

import { supabaseAdmin } from '@/lib/supabase'
import { fakeDb } from './fake-db'
import type { GscAnalyticsRow } from '../client'
import {
  buildPageDailyPlan,
  closeReceipt,
  closeReceiptIfRunning,
  loadPlanReceipts,
  openReceipt,
  recordFinalizedRange,
  toPageDailyRows,
  toPlanReceipt,
  upsertPageDayRows,
  MAX_URL_BYTES,
} from '../page-daily-store'

const A = 'c0000000-0000-0000-0000-000000000000'
const B = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const SITE = 'https://a.example.com/'
const DAY = '2026-09-20'

function row(url: string, clicks = 1): GscAnalyticsRow {
  return { keys: [url], clicks, impressions: clicks * 10, ctr: 0.1, position: 3.5 }
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

describe('upsertPageDayRows', () => {
  it('upserts in batches of 500 with the normalised key, deduping by raw URL and skipping over-long URLs', async () => {
    const input: GscAnalyticsRow[] = []
    for (let i = 0; i < 1203; i += 1) {
      input.push(row(`https://www.example.com/p/${i}/?utm_source=x`, 1))
    }
    input.push(row('https://www.example.com/p/0/?utm_source=x', 9))
    input.push(row('https://example.com/' + 'a'.repeat(MAX_URL_BYTES + 100)))

    const result = await upsertPageDayRows(supabaseAdmin, A, DAY, input)

    expect(result).toEqual({ written: 1203, skippedLongUrls: 1 })
    expect(fakeDb.calls.filter((c) => c.startsWith('upsert gsc_page_daily'))).toEqual([
      'upsert gsc_page_daily 500',
      'upsert gsc_page_daily 500',
      'upsert gsc_page_daily 203',
    ])
    const stored = fakeDb.tables.gsc_page_daily
    expect(stored).toHaveLength(1203)
    const first = stored.find((r) => r.page_url === 'https://www.example.com/p/0/?utm_source=x')
    expect(first?.clicks).toBe(9)
    expect(first?.page_key).toBe('example.com/p/0')
  })

  it('running the same day twice is idempotent', async () => {
    const input = [row('https://www.example.com/a'), row('https://www.example.com/b'), row('https://www.example.com/c')]

    await upsertPageDayRows(supabaseAdmin, A, DAY, input)
    await upsertPageDayRows(supabaseAdmin, A, DAY, input)

    expect(fakeDb.tables.gsc_page_daily).toHaveLength(3)
  })

  it('a failed batch throws and is never counted as written', async () => {
    fakeDb.fail({ table: 'gsc_page_daily', op: 'upsert', message: 'deadlock detected', times: 1 })

    await expect(upsertPageDayRows(supabaseAdmin, A, DAY, [row('https://www.example.com/a')])).rejects.toThrow(
      /\[db\] gsc_page_daily upsert failed for 2026-09-20.*deadlock detected/,
    )
  })
})

describe('toPageDailyRows', () => {
  it('rounds counts, falls back to the raw URL when it has no key, and drops rows without a URL', () => {
    const rows: GscAnalyticsRow[] = [
      { keys: ['https://a.example.com/x'], clicks: 2.0, impressions: 30.4, ctr: 0.05, position: 7.25 },
      { keys: ['not a url'], clicks: 1, impressions: 1, ctr: 1, position: 1 },
      { keys: [], clicks: 1, impressions: 1, ctr: 1, position: 1 },
    ]

    const result = toPageDailyRows(A, DAY, rows)

    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].impressions).toBe(30)
    expect(result.rows[0].page_key).toBe('a.example.com/x')
    expect(result.rows[1].page_key).toBe('not a url')
    expect(result.skippedLongUrls).toBe(0)
  })
})

describe('receipts', () => {
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

  it('openReceipt inserts a running receipt; a retried insert of the same id is a no-op; other errors throw', async () => {
    await openReceipt(supabaseAdmin, input)
    await openReceipt(supabaseAdmin, input)

    const stored = fakeDb.tables.gsc_page_fetch_receipts
    expect(stored).toHaveLength(1)
    expect(stored[0].status).toBe('running')
    expect(stored[0].inngest_run_id).toBe('run-1')

    fakeDb.fail({ table: 'gsc_page_fetch_receipts', op: 'insert', message: 'permission denied', times: 1 })
    await expect(openReceipt(supabaseAdmin, { ...input, id: 'r-2' })).rejects.toThrow(
      /\[db\] gsc_page_fetch_receipts insert failed.*permission denied/,
    )
  })

  it('recordFinalizedRange and closeReceipt touch only that receipt', async () => {
    await openReceipt(supabaseAdmin, input)
    await openReceipt(supabaseAdmin, { ...input, id: 'r-2' })

    await recordFinalizedRange(supabaseAdmin, 'r-1', { firstDay: '2026-09-21', lastDay: '2026-09-23' })
    await closeReceipt(
      supabaseAdmin,
      'r-1',
      { status: 'complete', failure_kind: null, row_count: 120, request_count: 4, skipped_long_urls: 0, error: null },
      new Date('2026-09-26T18:35:00Z'),
    )

    const stored = fakeDb.tables.gsc_page_fetch_receipts
    const r1 = stored.find((r) => r.id === 'r-1')
    const r2 = stored.find((r) => r.id === 'r-2')
    expect(r1?.data_from_day).toBe('2026-09-21')
    expect(r1?.data_through_day).toBe('2026-09-23')
    expect(r1?.status).toBe('complete')
    expect(r1?.row_count).toBe(120)
    expect(r1?.finished_at).toBe('2026-09-26T18:35:00.000Z')
    expect(r2?.status).toBe('running')
    expect(r2?.data_through_day).toBeNull()
    expect(r2?.finished_at).toBeNull()
  })

  it('🔴 closeReceiptIfRunning closes only that receipt, and only while it is running', async () => {
    fakeDb.tables.gsc_page_fetch_receipts = [
      receiptRow({ id: 'x1', status: 'running', finished_at: null, started_at: '2026-09-26T18:30:00Z' }),
      receiptRow({ id: 'x2', status: 'running', finished_at: null }),
      receiptRow({ id: 'x3', status: 'complete' }),
    ]

    const closed = await closeReceiptIfRunning(
      supabaseAdmin,
      'x1',
      { failure_kind: 'quota', error: 'retries exhausted' },
      new Date('2026-09-26T19:00:00Z'),
    )

    expect(closed).toEqual({ started_at: '2026-09-26T18:30:00Z' })
    const stored = fakeDb.tables.gsc_page_fetch_receipts
    const x1 = stored.find((r) => r.id === 'x1')
    const x2 = stored.find((r) => r.id === 'x2')
    const x3 = stored.find((r) => r.id === 'x3')
    expect(x1?.status).toBe('failed')
    expect(x1?.failure_kind).toBe('quota')
    expect(x1?.error).toBe('retries exhausted')
    expect(x1?.finished_at).toBe('2026-09-26T19:00:00.000Z')
    expect(x2?.status).toBe('running')

    const alreadyClosed = await closeReceiptIfRunning(supabaseAdmin, 'x3', { failure_kind: 'other', error: 'x' })
    expect(alreadyClosed).toBeNull()
    expect(x3?.status).toBe('complete')
  })

  it('closeReceiptIfRunning never throws on a database error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeDb.fail({ table: 'gsc_page_fetch_receipts', op: 'update', message: 'db down' })

    await expect(closeReceiptIfRunning(supabaseAdmin, 'x1', { failure_kind: 'other', error: 'x' })).resolves.toBeNull()
  })
})

describe('loadPlanReceipts', () => {
  it('reads every status of the listed clients inside the window, across pages', async () => {
    const seeded: Record<string, unknown>[] = []
    for (let i = 0; i < 1500; i += 1) {
      seeded.push(receiptRow({ id: `c-${String(i).padStart(4, '0')}` }))
    }
    seeded.push(receiptRow({ id: 'r-running', status: 'running' }))
    seeded.push(receiptRow({ id: 'r-other', client_id: B }))
    seeded.push(receiptRow({ id: 'r-old', request_start_day: '2025-01-01', request_end_day: '2025-01-31' }))
    seeded.push(receiptRow({ id: 'r-failed', status: 'failed', failure_kind: 'quota' }))
    fakeDb.tables.gsc_page_fetch_receipts = seeded

    const receipts = await loadPlanReceipts(supabaseAdmin, [A], '2025-06-01')

    expect(receipts).toHaveLength(1502)
    expect(receipts.every((r) => r.client_id === A)).toBe(true)
    const failed = receipts.find((r) => r.status === 'failed')
    expect(failed?.failure_kind).toBe('quota')
    expect(failed?.kind).toBe('backfill')
    expect(fakeDb.calls.filter((c) => c.startsWith('select gsc_page_fetch_receipts'))).toHaveLength(2)
  })

  it('toPlanReceipt skips rows with an unexpected shape', () => {
    expect(toPlanReceipt(receiptRow({}))).not.toBeNull()
    expect(toPlanReceipt(receiptRow({ status: 'weird' }))).toBeNull()
    expect(toPlanReceipt(receiptRow({ kind: 'weekly' }))).toBeNull()
    expect(toPlanReceipt(receiptRow({ started_at: null }))).toBeNull()
    expect(toPlanReceipt(receiptRow({ status: 'failed', failure_kind: 'nonsense' }))?.failure_kind).toBeNull()
  })
})

describe('buildPageDailyPlan', () => {
  it('skips a month already covered and reports read failures instead of an empty plan', async () => {
    fakeDb.tables.client_connectors = [
      { client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: SITE } },
    ]
    fakeDb.tables.gsc_page_fetch_receipts = [
      receiptRow({ request_start_day: '2026-09-01', request_end_day: '2026-09-20', data_through_day: '2026-09-20' }),
    ]

    const plan = await buildPageDailyPlan(supabaseAdmin, '2026-09-26')

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok plan')
    expect(plan.clients).toBe(1)
    expect(plan.stopped).toEqual([])
    expect(plan.newlyStopped).toEqual([])
    expect(plan.orders).toContainEqual({
      client_id: A,
      kind: 'daily',
      start_day: '2026-09-21',
      end_day: '2026-09-25',
    })
    expect(plan.orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-09-01')).toBe(false)
    expect(plan.orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-08-01')).toBe(true)

    fakeDb.fail({ table: 'client_connectors', op: 'select', message: 'boom', times: 1 })
    const rosterFailure = await buildPageDailyPlan(supabaseAdmin, '2026-09-26')
    expect(rosterFailure).toEqual({ ok: false, reason: 'roster: boom' })

    fakeDb.fail({ table: 'gsc_page_fetch_receipts', op: 'select', message: 'boom2', times: 1 })
    const receiptFailure = await buildPageDailyPlan(supabaseAdmin, '2026-09-26')
    expect(receiptFailure.ok).toBe(false)
    if (receiptFailure.ok) throw new Error('expected failed plan')
    expect(receiptFailure.reason).toBe('receipts: boom2')
  })

  it('🔴 a month with three consecutive failures is listed as stopped and not dispatched', async () => {
    fakeDb.tables.client_connectors = [
      { client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: SITE } },
    ]
    fakeDb.tables.gsc_page_fetch_receipts = [
      receiptRow({ request_start_day: '2026-09-01', request_end_day: '2026-09-20', data_through_day: '2026-09-20' }),
      receiptRow({ request_start_day: '2026-08-01', request_end_day: '2026-08-31', data_through_day: '2026-08-31' }),
      receiptRow({
        request_start_day: '2026-07-01',
        request_end_day: '2026-07-31',
        status: 'failed',
        failure_kind: 'other',
        data_through_day: null,
        started_at: '2026-09-23T18:31:00Z',
      }),
      receiptRow({
        request_start_day: '2026-07-01',
        request_end_day: '2026-07-31',
        status: 'failed',
        failure_kind: 'other',
        data_through_day: null,
        started_at: '2026-09-24T18:31:00Z',
      }),
      receiptRow({
        request_start_day: '2026-07-01',
        request_end_day: '2026-07-31',
        status: 'failed',
        failure_kind: 'other',
        data_through_day: null,
        started_at: '2026-09-25T18:31:00Z',
      }),
    ]

    const plan = await buildPageDailyPlan(supabaseAdmin, '2026-09-26')

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('expected ok plan')
    expect(plan.stopped).toEqual([{ client_id: A, month: '2026-07', stopped_on: '2026-09-25' }])
    expect(plan.newlyStopped).toEqual([{ client_id: A, month: '2026-07', stopped_on: '2026-09-25' }])
    expect(plan.orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-07-01')).toBe(false)
    const backfillStarts = plan.orders.filter((o) => o.kind === 'backfill').map((o) => o.start_day)
    expect(backfillStarts).toEqual(['2026-06-01', '2026-05-01', '2026-04-01'])
  })
})
