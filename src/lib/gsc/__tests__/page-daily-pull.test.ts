// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('./fake-db')).fakeDb.client }))

import { NonRetriableError, RetryAfterError } from 'inngest'
import { supabaseAdmin } from '@/lib/supabase'
import { fakeDb, type Row } from './fake-db'
import { cronRunIdFromInngestRun } from '@/lib/cron/run-logger'
import { GscApiError, type GscAnalyticsRow, type GscDayRange, type GscRowsQuery } from '../client'
import { GSC_PAGE_DAILY_PULL_JOB, type PullOrder } from '../page-daily-plan'
import { MAX_URL_BYTES } from '../page-daily-store'
import {
  daysToPull,
  failureKindOf,
  handlePullFailure,
  runPageDailyPull,
  toStepError,
  MAX_PAGES_PER_DAY,
  PAGE_ROW_LIMIT,
  type PullDeps,
  type PullStep,
} from '../page-daily-pull'

const A = 'c0000000-0000-0000-0000-000000000000'
const SITE = 'https://a.example.com/'
const DAILY: PullOrder = { client_id: A, kind: 'daily', start_day: '2026-09-21', end_day: '2026-09-25' }
const CTX = { runId: 'run-1', eventId: 'evt-1' }

/** `count` Search Analytics rows for one day, one per page URL. */
function rows(day: string, count: number, offset = 0): GscAnalyticsRow[] {
  return Array.from({ length: count }, (_v, i) => ({
    keys: [`https://www.a.example.com/${day}/p${offset + i}`],
    clicks: 1,
    impressions: 10,
    ctr: 0.1,
    position: 5,
  }))
}

/** A fake step that records ids and rethrows errors (models "retries are used up"). */
function harness(): { ids: string[]; thrown: Array<{ id: string; error: unknown }>; step: PullStep } {
  const ids: string[] = []
  const thrown: Array<{ id: string; error: unknown }> = []
  const step: PullStep = {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      ids.push(id)
      try {
        return await fn()
      } catch (error) {
        thrown.push({ id, error })
        throw error
      }
    },
  }
  return { ids, thrown, step }
}

/** A step runner that executes every step TWICE and keeps the second result — like a step whose first attempt
 *  committed but whose response was lost, so Inngest ran it again with the same run id. */
function doubleRunHarness(): { ids: string[]; step: PullStep } {
  const ids: string[] = []
  const step: PullStep = {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      ids.push(id)
      await fn()
      return fn()
    },
  }
  return { ids, step }
}

interface DepsOverrides {
  range?: GscDayRange | null
  rangeError?: unknown
  pageRows?: (query: GscRowsQuery) => GscAnalyticsRow[] | null
  pageError?: (query: GscRowsQuery) => unknown
  siteUrl?: string | null
}

/** Build PullDeps with vi.fn spies so tests can inspect the calls. */
function deps(over: DepsOverrides): {
  deps: PullDeps
  fetchRows: ReturnType<typeof vi.fn>
  fetchFinalizedRange: ReturnType<typeof vi.fn>
} {
  const fetchFinalizedRange = vi.fn(async () => {
    if (over.rangeError !== undefined) throw over.rangeError
    return over.range === undefined ? { firstDay: '2026-09-21', lastDay: '2026-09-23' } : over.range
  })
  const fetchRows = vi.fn(async (_c: string, _s: string, q: GscRowsQuery) => {
    const e = over.pageError?.(q)
    if (e !== undefined) throw e
    return over.pageRows ? over.pageRows(q) : rows(q.startDate, 3)
  })
  const built: PullDeps = {
    supabase: supabaseAdmin,
    loadSiteUrl: async () => (over.siteUrl === undefined ? SITE : over.siteUrl),
    fetchRows,
    fetchFinalizedRange,
  }
  return { deps: built, fetchRows, fetchFinalizedRange }
}

function receiptRows(): Row[] {
  return fakeDb.tables.gsc_page_fetch_receipts ?? []
}

function runLogRows(): Row[] {
  return fakeDb.tables.cron_run_logs ?? []
}

/** Read a summary field without casting through unknown. */
function summaryField(row: Row, key: string): unknown {
  const s = row.summary
  return s && typeof s === 'object' && key in s ? (s as Record<string, unknown>)[key] : null
}

beforeEach(() => {
  fakeDb.reset()
  vi.restoreAllMocks()
})

describe('runPageDailyPull', () => {
  it('🔴 only finalised days are pulled — the last two days of a daily window are not', async () => {
    const h = harness()
    const d = deps({})
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    expect(out.status).toBe('complete')
    expect(out.days_pulled).toBe(3)
    expect(out.row_count).toBe(9)
    expect(out.request_count).toBe(4)
    expect(out.data_from_day).toBe('2026-09-21')
    expect(out.data_through_day).toBe('2026-09-23')

    expect(d.fetchRows.mock.calls.map((c) => (c[2] as GscRowsQuery).startDate)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ])
    for (const call of d.fetchRows.mock.calls) {
      const q = call[2] as GscRowsQuery
      expect(q.dimensions).toEqual(['page'])
      expect(q.rowLimit).toBe(PAGE_ROW_LIMIT)
    }

    expect(h.ids).toEqual([
      'log-start',
      'open-receipt',
      'finalized-range',
      'pull-2026-09-21',
      'pull-2026-09-22',
      'pull-2026-09-23',
      'close-receipt',
      'log-finish',
    ])

    const receipts = receiptRows()
    expect(receipts).toHaveLength(1)
    const receipt = receipts[0]
    expect(receipt.status).toBe('complete')
    expect(receipt.row_count).toBe(9)
    expect(receipt.request_count).toBe(4)
    expect(receipt.inngest_run_id).toBe('run-1')
    expect(receipt.inngest_event_id).toBe('evt-1')
    expect(receipt.data_through_day).toBe('2026-09-23')
    expect(receipt.finished_at).not.toBeNull()

    const logs = runLogRows()
    expect(logs).toHaveLength(1)
    expect(receipt.id).toBe(out.receipt_id)
    expect(logs[0].id).toBe(out.receipt_id)
    expect(out.receipt_id).toBe(cronRunIdFromInngestRun(CTX.runId))
    expect(logs[0].job_name).toBe(GSC_PAGE_DAILY_PULL_JOB)
    expect(logs[0].status).toBe('completed')
    expect(logs[0].processed).toBe(1)
    expect(logs[0].failed_count).toBe(0)

    expect(fakeDb.tables.gsc_page_daily).toHaveLength(9)
  })

  it('🔴 a full page is followed by exactly one more page', async () => {
    const h = harness()
    const d = deps({
      range: { firstDay: '2026-09-21', lastDay: '2026-09-21' },
      pageRows: (q) => ((q.startRow ?? 0) === 0 ? rows(q.startDate, PAGE_ROW_LIMIT) : rows(q.startDate, 10, PAGE_ROW_LIMIT)),
    })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    expect(d.fetchRows.mock.calls.map((c) => (c[2] as GscRowsQuery).startRow)).toEqual([0, PAGE_ROW_LIMIT])
    expect(h.ids).toContain('pull-2026-09-21')
    expect(h.ids).toContain('pull-2026-09-21-p2')
    expect(h.ids).not.toContain('pull-2026-09-21-p3')
    expect(out.row_count).toBe(PAGE_ROW_LIMIT + 10)
    expect(out.status).toBe('complete')
    expect(out.request_count).toBe(3)
  })

  it("🔴 page 2 still full → the day reached Google's 50,000-row cap: truncated, and the order counts as failed in the run log", async () => {
    const h = harness()
    const d = deps({
      range: { firstDay: '2026-09-21', lastDay: '2026-09-21' },
      pageRows: (q) => rows(q.startDate, PAGE_ROW_LIMIT),
    })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    expect(d.fetchRows.mock.calls.map((c) => (c[2] as GscRowsQuery).startRow)).toEqual([0, PAGE_ROW_LIMIT])
    expect(MAX_PAGES_PER_DAY).toBe(2)
    expect(h.ids).not.toContain('pull-2026-09-21-p3')
    expect(out.status).toBe('truncated')
    expect(out.truncated_days).toEqual(['2026-09-21'])

    const receipt = receiptRows()[0]
    expect(receipt.status).toBe('truncated')
    expect(String(receipt.error)).toContain('50,000')
    expect(String(receipt.error)).toContain('2026-09-21')

    const log = runLogRows()[0]
    expect(log.status).toBe('failed')
    expect(log.failed_count).toBe(1)
  })

  it("🔴 429 → the step throws RetryAfterError with Google's wait; when retries run out the receipt fails as quota", async () => {
    const h = harness()
    const d = deps({
      pageError: (q) =>
        q.startDate === '2026-09-22'
          ? new GscApiError(429, 'RESOURCE_EXHAUSTED', 'rateLimitExceeded', 'Quota exceeded', '', 120000)
          : undefined,
    })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    const entry = h.thrown.find((t) => t.id === 'pull-2026-09-22')
    expect(entry).toBeDefined()
    expect(entry?.error).toBeInstanceOf(RetryAfterError)
    expect((entry?.error as RetryAfterError).retryAfter).toBe('120')

    expect(out.status).toBe('failed')
    expect(out.failure_kind).toBe('quota')
    expect(out.row_count).toBe(3)
    expect(h.ids).not.toContain('pull-2026-09-23')

    const receipt = receiptRows()[0]
    expect(receipt.status).toBe('failed')
    expect(receipt.failure_kind).toBe('quota')
    expect(runLogRows()[0].status).toBe('failed')
  })

  it('🔴 403 → NonRetriableError, receipt failed as auth, run log NOT counted as failed', async () => {
    const h = harness()
    const d = deps({
      rangeError: new GscApiError(403, 'PERMISSION_DENIED', 'forbidden', 'User does not have sufficient permission'),
    })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    const entry = h.thrown.find((t) => t.id === 'finalized-range')
    expect(entry?.error).toBeInstanceOf(NonRetriableError)
    expect((entry?.error as Error).message).toContain('[gsc:auth]')
    expect(d.fetchRows).not.toHaveBeenCalled()

    expect(out.status).toBe('failed')
    expect(out.failure_kind).toBe('auth')

    const receipt = receiptRows()[0]
    expect(receipt.status).toBe('failed')
    expect(receipt.failure_kind).toBe('auth')
    expect(String(receipt.error)).toContain('[gsc:auth]')

    const log = runLogRows()[0]
    expect(log.status).toBe('completed')
    expect(log.failed_count).toBe(0)
    expect(summaryField(log, 'failure_kind')).toBe('auth')
  })

  it('no usable token is an auth failure too', async () => {
    const h = harness()
    const d = deps({ range: null })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    const entry = h.thrown.find((t) => t.id === 'finalized-range')
    expect(entry?.error).toBeInstanceOf(NonRetriableError)
    expect((entry?.error as Error).message).toContain('no usable GSC token')
    expect(out.failure_kind).toBe('auth')
  })

  it('400 → failure_kind other and it counts as failed', async () => {
    const h = harness()
    const d = deps({ rangeError: new GscApiError(400, 'INVALID_ARGUMENT', 'badRequest', 'bad date') })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    const entry = h.thrown.find((t) => t.id === 'finalized-range')
    expect(entry?.error).toBeInstanceOf(NonRetriableError)
    expect(out.failure_kind).toBe('other')
    expect(runLogRows()[0].status).toBe('failed')
  })

  it('🔴 a write error is thrown as a plain retriable error and, when it keeps failing, fails the receipt', async () => {
    fakeDb.fail({ table: 'gsc_page_daily', op: 'upsert', message: 'deadlock detected' })
    const h = harness()
    const d = deps({})
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    const entry = h.thrown.find((t) => t.id === 'pull-2026-09-21')
    expect(entry?.error).toBeInstanceOf(Error)
    expect(entry?.error).not.toBeInstanceOf(NonRetriableError)
    expect(entry?.error).not.toBeInstanceOf(RetryAfterError)
    expect((entry?.error as Error).message).toContain('[db]')

    expect(out.status).toBe('failed')
    expect(out.failure_kind).toBe('other')
    expect(out.row_count).toBe(0)
    expect(receiptRows()[0].status).toBe('failed')
    expect(runLogRows()[0].status).toBe('failed')
  })

  it('over-long URLs are skipped and counted on the receipt', async () => {
    const h = harness()
    const d = deps({
      range: { firstDay: '2026-09-21', lastDay: '2026-09-21' },
      pageRows: (q) => [
        ...rows(q.startDate, 2),
        {
          keys: [`https://a.example.com/${'x'.repeat(MAX_URL_BYTES + 1)}`],
          clicks: 1,
          impressions: 1,
          ctr: 1,
          position: 1,
        },
      ],
    })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    expect(out.skipped_long_urls).toBe(1)
    expect(out.row_count).toBe(2)
    expect(receiptRows()[0].skipped_long_urls).toBe(1)
  })

  it('a client that is no longer connected is skipped without a receipt', async () => {
    const h = harness()
    const d = deps({ siteUrl: null })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    expect(out.status).toBe('skipped')
    expect(out.receipt_id).toBeNull()
    expect(receiptRows()).toHaveLength(0)
    expect(d.fetchFinalizedRange).not.toHaveBeenCalled()
    expect(d.fetchRows).not.toHaveBeenCalled()
    expect(runLogRows()[0].status).toBe('completed')
    expect(h.ids).toEqual(['log-start', 'open-receipt', 'log-finish'])
  })

  it('no finalised data in the range → complete with no day steps', async () => {
    const h = harness()
    const d = deps({ range: { firstDay: null, lastDay: null } })
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    expect(out.status).toBe('complete')
    expect(out.days_pulled).toBe(0)
    expect(out.request_count).toBe(1)
    expect(receiptRows()[0].data_from_day).toBeNull()
  })

  it("🔴 retried steps reuse the run's fixed id: one run-log row, one receipt, no duplicate data", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = doubleRunHarness()
    const d = deps({})
    const out = await runPageDailyPull(h.step, d.deps, DAILY, CTX)

    expect(out.status).toBe('complete')

    const logs = runLogRows()
    expect(logs).toHaveLength(1)
    expect(logs[0].id).toBe(cronRunIdFromInngestRun(CTX.runId))
    expect(logs[0].status).toBe('completed')

    const receipts = receiptRows()
    expect(receipts).toHaveLength(1)
    expect(receipts[0].id).toBe(cronRunIdFromInngestRun(CTX.runId))
    expect(receipts[0].status).toBe('complete')

    expect(fakeDb.tables.gsc_page_daily).toHaveLength(9)
    expect(errors).not.toHaveBeenCalled()
  })
})

describe('toStepError / failureKindOf / daysToPull', () => {
  it('maps Google errors to the right Inngest error', () => {
    const quota = toStepError(new GscApiError(429, '', '', 'q'))
    expect(quota).toBeInstanceOf(RetryAfterError)
    expect((quota as RetryAfterError).retryAfter).toBe('60')

    const auth = toStepError(new GscApiError(401, 'UNAUTHENTICATED', '', 'x'))
    expect(auth).toBeInstanceOf(NonRetriableError)
    expect(auth.message).toContain('[gsc:auth]')

    const other = toStepError(new GscApiError(404, 'NOT_FOUND', '', 'x'))
    expect(other).toBeInstanceOf(NonRetriableError)
    expect(other.message).toContain('[gsc:other]')

    const server = toStepError(new GscApiError(503, 'UNAVAILABLE', '', 'x'))
    expect(server).toBeInstanceOf(Error)
    expect(server).not.toBeInstanceOf(NonRetriableError)
    expect(server.message).toContain('[gsc:other]')

    expect(failureKindOf('x [gsc:quota] y')).toBe('quota')
    expect(failureKindOf('boom')).toBe('other')

    expect(daysToPull(DAILY, { firstDay: '2026-09-20', lastDay: '2026-09-22' })).toEqual([
      '2026-09-21',
      '2026-09-22',
    ])
    expect(daysToPull(DAILY, { firstDay: null, lastDay: null })).toEqual([])
  })
})

describe('handlePullFailure', () => {
  const ID = cronRunIdFromInngestRun('run-9')
  const FAILED_AT = new Date('2026-09-26T19:00:00Z')
  function receiptRow(id: string, status: string): Row {
    return {
      id, client_id: A, site_url: SITE, kind: 'daily', request_start_day: '2026-09-21', request_end_day: '2026-09-25',
      status, inngest_run_id: id === ID ? 'run-9' : 'run-other', started_at: '2026-09-26T18:30:00Z', finished_at: null,
    }
  }
  function logRow(id: string, status: string): Row {
    return { id, job_name: GSC_PAGE_DAILY_PULL_JOB, status, started_at: '2026-09-26T18:30:00Z' }
  }

  it('🔴 closes only its own order: the receipt and run-log row with its fixed id, not a sibling running at the same time', async () => {
    fakeDb.tables.gsc_page_fetch_receipts = [receiptRow(ID, 'running'), receiptRow('sibling', 'running')]
    fakeDb.tables.cron_run_logs = [logRow(ID, 'running'), logRow('sibling', 'running')]

    const result = await handlePullFailure(supabaseAdmin, {
      runId: 'run-9',
      message: '[gsc:quota] 429 Quota exceeded',
      failedAt: FAILED_AT,
    })

    expect(result).toEqual({ receiptClosed: true, runLog: 'closed' })
    const receipt = receiptRows().find((r) => r.id === ID)
    expect(receipt?.status).toBe('failed')
    expect(receipt?.failure_kind).toBe('quota')
    expect(receiptRows().find((r) => r.id === 'sibling')?.status).toBe('running')

    const logs = runLogRows()
    const own = logs.find((r) => r.id === ID)
    expect(own?.status).toBe('failed')
    expect(own?.started_at).toBe('2026-09-26T18:30:00.000Z')
    expect(logs.find((r) => r.id === 'sibling')?.status).toBe('running')
  })

  it('an auth failure closes the receipt but not as a run failure', async () => {
    fakeDb.tables.gsc_page_fetch_receipts = [receiptRow(ID, 'running'), receiptRow('sibling', 'running')]
    fakeDb.tables.cron_run_logs = [logRow(ID, 'running'), logRow('sibling', 'running')]

    await handlePullFailure(supabaseAdmin, {
      runId: 'run-9',
      message: '[gsc:auth] 403 forbidden',
      failedAt: FAILED_AT,
    })

    expect(receiptRows().find((r) => r.id === ID)?.failure_kind).toBe('auth')
    const log = runLogRows().find((r) => r.id === ID)
    expect(log?.status).toBe('completed')
    expect(log?.failed_count).toBe(0)
  })

  it('🔴 the run died before opening its receipt → only its own run-log row is written', async () => {
    fakeDb.tables.cron_run_logs = [logRow('sibling', 'running')]

    const result = await handlePullFailure(supabaseAdmin, {
      runId: 'run-9',
      message: 'Error: step timed out',
      failedAt: FAILED_AT,
    })

    expect(result).toEqual({ receiptClosed: false, runLog: 'closed' })
    const own = runLogRows().find((r) => r.id === ID)
    expect(own?.status).toBe('failed')
    expect(own?.job_name).toBe(GSC_PAGE_DAILY_PULL_JOB)
    expect(own?.started_at).toBe('2026-09-26T19:00:00.000Z')
    expect(runLogRows().find((r) => r.id === 'sibling')?.status).toBe('running')
    expect(runLogRows()).toHaveLength(2)
  })

  it('a run-log row that is already terminal is not overwritten', async () => {
    fakeDb.tables.gsc_page_fetch_receipts = [receiptRow(ID, 'complete')]
    fakeDb.tables.cron_run_logs = [logRow(ID, 'completed')]

    const result = await handlePullFailure(supabaseAdmin, {
      runId: 'run-9',
      message: '[gsc:quota] 429 Quota exceeded',
      failedAt: FAILED_AT,
    })

    expect(result).toEqual({ receiptClosed: false, runLog: 'already_terminal' })
    expect(receiptRows().find((r) => r.id === ID)?.status).toBe('complete')
    expect(runLogRows().find((r) => r.id === ID)?.status).toBe('completed')
  })

  it('no run id → nothing is touched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeDb.tables.cron_run_logs = [logRow('sibling', 'running')]

    const result = await handlePullFailure(supabaseAdmin, {
      runId: null,
      message: 'x',
      failedAt: FAILED_AT,
    })

    expect(result).toEqual({ receiptClosed: false, runLog: 'no_run_id' })
    expect(runLogRows()).toHaveLength(1)
    expect(runLogRows()[0].status).toBe('running')
  })
})
