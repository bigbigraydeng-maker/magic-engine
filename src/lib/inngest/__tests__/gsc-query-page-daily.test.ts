// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('../../gsc/__tests__/fake-db')).fakeDb.client }))

import { supabaseAdmin } from '@/lib/supabase'
import { fakeDb, type Row } from '../../gsc/__tests__/fake-db'
import { cronRunIdFromInngestRun } from '@/lib/cron/run-logger'
import { GscApiError, type GscAnalyticsRow, type GscDayRange, type GscRowsQuery } from '../../gsc/client'
import type { PullOrder } from '../../gsc/page-daily-plan'
import {
  runPageDailyPull,
  handlePullFailure,
  type PullDeps,
  type PullStep,
} from '../../gsc/page-daily-pull'
import {
  QUERY_PAGE_DATASET,
  QUERY_PAGE_DAILY_TABLE,
  QUERY_PAGE_RECEIPTS_TABLE,
  GSC_QUERY_PAGE_DAILY_JOB,
  GSC_QUERY_PAGE_DAILY_PULL_JOB,
  GSC_QUERY_PAGE_DAILY_PULL_EVENT,
  GSC_QUERY_PAGE_DAILY_CRON,
} from '../../gsc/query-page-daily-store'
import {
  PAGE_CHAIN,
  buildPullEvents,
  gscPageDailyFanOut,
  gscPageDailyPull,
  type PullEvent,
} from '../functions/gsc-page-daily'
import {
  QUERY_PAGE_CHAIN,
  GSC_QUERY_PAGE_DAILY_FANOUT_ID,
  GSC_QUERY_PAGE_DAILY_PULL_ID,
  QUERY_PAGE_PULL_DEPS,
  gscQueryPageDailyFanOut,
  gscQueryPageDailyPull,
  queryPageFanOutDeps,
} from '../functions/gsc-query-page-daily'
import { CLOUD_FN_PREFIX } from '../client'

const A = 'c0000000-0000-0000-0000-000000000000'
const SITE = 'https://a.example.com/'
const BACKFILL: PullOrder = {
  client_id: A,
  kind: 'backfill',
  start_day: '2026-08-01',
  end_day: '2026-08-31',
}
const CTX = { runId: 'run-qp-1', eventId: 'evt-qp-1' }

/** `count` Search Analytics rows for one day, one per (query, page) pair. */
function rows(day: string, count: number, offset = 0): GscAnalyticsRow[] {
  return Array.from({ length: count }, (_v, i) => ({
    keys: [`query-${offset + i}`, `https://www.a.example.com/${day}/p${offset + i}`],
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

interface DepsOverrides {
  range?: GscDayRange | null
  rangeError?: unknown
  pageRows?: (query: GscRowsQuery) => GscAnalyticsRow[] | null
  pageError?: (query: GscRowsQuery) => unknown
  siteUrl?: string | null
  dataset?: PullDeps['dataset']
}

/** Build PullDeps with vi.fn spies so tests can inspect the calls. */
function deps(over: DepsOverrides): {
  deps: PullDeps
  fetchRows: ReturnType<typeof vi.fn>
  fetchFinalizedRange: ReturnType<typeof vi.fn>
} {
  const fetchFinalizedRange = vi.fn(async () => {
    if (over.rangeError !== undefined) throw over.rangeError
    return over.range === undefined ? { firstDay: '2026-08-01', lastDay: '2026-08-02' } : over.range
  })
  const fetchRows = vi.fn(async (_c: string, _s: string, q: GscRowsQuery) => {
    const e = over.pageError?.(q)
    if (e !== undefined) throw e
    return over.pageRows ? over.pageRows(q) : rows(q.startDate, 3)
  })
  const built: PullDeps = {
    supabase: supabaseAdmin,
    dataset: over.dataset,
    loadSiteUrl: async () => (over.siteUrl === undefined ? SITE : over.siteUrl),
    fetchRows,
    fetchFinalizedRange,
  }
  return { deps: built, fetchRows, fetchFinalizedRange }
}

function queryPageRows(): Row[] {
  return fakeDb.tables[QUERY_PAGE_DAILY_TABLE] ?? []
}

function queryPageReceipts(): Row[] {
  return fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE] ?? []
}

function pageRows(): Row[] {
  return fakeDb.tables.gsc_page_daily ?? []
}

function pageReceipts(): Row[] {
  return fakeDb.tables.gsc_page_fetch_receipts ?? []
}

function runLogRows(): Row[] {
  return fakeDb.tables.cron_run_logs ?? []
}

beforeEach(() => {
  fakeDb.reset()
  vi.restoreAllMocks()
})

describe('QUERY_PAGE_CHAIN isolation from PAGE_CHAIN', () => {
  it('🔴 differs from PAGE_CHAIN in every identifying field', () => {
    expect(QUERY_PAGE_CHAIN.job).not.toBe(PAGE_CHAIN.job)
    expect(QUERY_PAGE_CHAIN.eventName).not.toBe(PAGE_CHAIN.eventName)
    expect(QUERY_PAGE_CHAIN.eventIdPrefix).not.toBe(PAGE_CHAIN.eventIdPrefix)
    expect(QUERY_PAGE_CHAIN.fanoutId).not.toBe(PAGE_CHAIN.fanoutId)
    expect(QUERY_PAGE_CHAIN.pullId).not.toBe(PAGE_CHAIN.pullId)
    expect(QUERY_PAGE_CHAIN.cron).not.toBe(PAGE_CHAIN.cron)

    expect(QUERY_PAGE_CHAIN.job).toBe(GSC_QUERY_PAGE_DAILY_JOB)
    expect(QUERY_PAGE_CHAIN.eventName).toBe(GSC_QUERY_PAGE_DAILY_PULL_EVENT)
    expect(QUERY_PAGE_CHAIN.cron).toBe(GSC_QUERY_PAGE_DAILY_CRON)
    expect(QUERY_PAGE_CHAIN.dataset).toBe(QUERY_PAGE_DATASET)
  })

  it('🔴 buildPullEvents uses the chain event name and id prefix', () => {
    const orders: PullOrder[] = [BACKFILL]

    const qp: PullEvent[] = buildPullEvents(orders, QUERY_PAGE_CHAIN)
    expect(qp).toHaveLength(1)
    expect(qp[0].name).toBe('gsc/query-page-daily.pull.due')
    expect(qp[0].id.startsWith('gsc-query-page-daily:')).toBe(true)

    const page: PullEvent[] = buildPullEvents(orders)
    expect(page).toHaveLength(1)
    expect(page[0].name).toBe('gsc/page-daily.pull.due')
    expect(page[0].id.startsWith('gsc-page-daily:')).toBe(true)

    expect(qp[0].id).not.toBe(page[0].id)
  })

  it('🔴 the Inngest function ids are cloud-prefixed and distinct from the page chain', () => {
    expect(CLOUD_FN_PREFIX.length).toBeGreaterThan(0)
    expect(GSC_QUERY_PAGE_DAILY_FANOUT_ID.startsWith(CLOUD_FN_PREFIX)).toBe(true)
    expect(GSC_QUERY_PAGE_DAILY_PULL_ID.startsWith(CLOUD_FN_PREFIX)).toBe(true)
    expect(GSC_QUERY_PAGE_DAILY_FANOUT_ID).not.toBe(PAGE_CHAIN.fanoutId)
    expect(GSC_QUERY_PAGE_DAILY_PULL_ID).not.toBe(PAGE_CHAIN.pullId)
  })

  it('the exported Inngest function objects exist', () => {
    expect(gscQueryPageDailyFanOut).toBeDefined()
    expect(gscQueryPageDailyPull).toBeDefined()
  })
})

describe('runPageDailyPull with QUERY_PAGE_DATASET', () => {
  it('🔴 writes to the query-page tables and run log, never the page tables', async () => {
    const h = harness()
    const d = deps({ dataset: QUERY_PAGE_DATASET })
    const out = await runPageDailyPull(h.step, d.deps, BACKFILL, CTX)

    expect(out.status).toBe('complete')
    expect(out.days_pulled).toBe(2)
    expect(out.row_count).toBe(6)

    // fetchRows was asked for the (query, page) dimensions.
    for (const call of d.fetchRows.mock.calls) {
      const q = call[2] as GscRowsQuery
      expect(q.dimensions).toEqual(['query', 'page'])
    }

    // Rows landed in the query-page table, not the page table.
    expect(queryPageRows()).toHaveLength(6)
    expect(pageRows()).toHaveLength(0)

    // Receipt in the query-page receipts table, not the page receipts table.
    const receipts = queryPageReceipts()
    expect(receipts).toHaveLength(1)
    expect(receipts[0].status).toBe('complete')
    expect(receipts[0].row_count).toBe(6)
    expect(pageReceipts()).toHaveLength(0)

    // Run log under the query-page pull job name, not the page pull job name.
    const logs = runLogRows()
    expect(logs).toHaveLength(1)
    expect(logs[0].job_name).toBe(GSC_QUERY_PAGE_DAILY_PULL_JOB)
    expect(logs.some((r) => r.job_name === 'gsc-page-daily-pull')).toBe(false)
  })

  it('🔴 with no dataset in deps the default page store is used (regression guard)', async () => {
    const h = harness()
    const d = deps({})
    const out = await runPageDailyPull(h.step, d.deps, BACKFILL, CTX)

    expect(out.status).toBe('complete')
    expect(out.row_count).toBe(6)

    expect(pageRows()).toHaveLength(6)
    expect(queryPageRows()).toHaveLength(0)

    expect(pageReceipts()).toHaveLength(1)
    expect(pageReceipts()[0].status).toBe('complete')
    expect(queryPageReceipts()).toHaveLength(0)

    const logs = runLogRows()
    expect(logs).toHaveLength(1)
    expect(logs[0].job_name).toBe('gsc-page-daily-pull')
    expect(logs.some((r) => r.job_name === GSC_QUERY_PAGE_DAILY_PULL_JOB)).toBe(false)
  })

  it('🔴 a 403 fails the query-page receipt as auth', async () => {
    const h = harness()
    const d = deps({
      dataset: QUERY_PAGE_DATASET,
      rangeError: new GscApiError(403, 'PERMISSION_DENIED', 'forbidden', 'User does not have sufficient permission'),
    })
    const out = await runPageDailyPull(h.step, d.deps, BACKFILL, CTX)

    expect(out.status).toBe('failed')
    expect(out.failure_kind).toBe('auth')

    const receipts = queryPageReceipts()
    expect(receipts).toHaveLength(1)
    expect(receipts[0].status).toBe('failed')
    expect(receipts[0].failure_kind).toBe('auth')
    expect(pageReceipts()).toHaveLength(0)
  })
})

describe('handlePullFailure with QUERY_PAGE_DATASET', () => {
  // The receipt id is the id derived from the Inngest run id — that is how onFailure finds its own receipt.
  const ID = cronRunIdFromInngestRun('run-qp-9')
  const FAILED_AT = new Date('2026-09-26T19:00:00Z')

  function receiptRow(id: string, status: string): Row {
    return {
      id,
      client_id: A,
      site_url: SITE,
      kind: 'backfill',
      request_start_day: '2026-08-01',
      request_end_day: '2026-08-31',
      status,
      inngest_run_id: 'run-qp-9',
      started_at: '2026-09-26T18:30:00Z',
      finished_at: null,
    }
  }

  it('🔴 closes a running receipt in the query-page receipts table only', async () => {
    fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE] = [receiptRow(ID, 'running')]
    fakeDb.tables.gsc_page_fetch_receipts = [receiptRow('page-sibling', 'running')]

    const result = await handlePullFailure(
      supabaseAdmin,
      { runId: 'run-qp-9', message: '[gsc:quota] 429 Quota exceeded', failedAt: FAILED_AT },
      QUERY_PAGE_DATASET,
    )

    expect(result.receiptClosed).toBe(true)

    const qp = queryPageReceipts().find((r) => r.id === ID)
    expect(qp?.status).toBe('failed')
    expect(qp?.failure_kind).toBe('quota')

    // The page receipts table is untouched.
    expect(pageReceipts().find((r) => r.id === 'page-sibling')?.status).toBe('running')
  })
})

describe('two things the shared pull must keep apart (added after mutation probes)', () => {
  it('🔴 different queries on the same page and day are separate rows (the key includes the query)', async () => {
    const h = harness()
    const d = deps({
      dataset: QUERY_PAGE_DATASET,
      range: { firstDay: '2026-08-01', lastDay: '2026-08-01' },
      pageRows: () => [
        { keys: ['china tours', 'https://a.example.com/tours'], clicks: 3, impressions: 30, ctr: 0.1, position: 4 },
        { keys: ['cheap china tours', 'https://a.example.com/tours'], clicks: 1, impressions: 20, ctr: 0.05, position: 7 },
        { keys: ['China Tours', 'https://a.example.com/tours'], clicks: 2, impressions: 10, ctr: 0.2, position: 5 },
      ],
    })
    await runPageDailyPull(h.step, d.deps, { ...BACKFILL, end_day: '2026-08-01' }, CTX)
    expect(queryPageRows()).toHaveLength(3)
    expect(new Set(queryPageRows().map((r) => r.query))).toEqual(new Set(['china tours', 'cheap china tours', 'China Tours']))
  })

  it('🔴 the order\'s run-log row carries the query-page job name from the moment it opens, not only at the end', async () => {
    const h = harness()
    const seen: string[] = []
    const d = deps({
      dataset: QUERY_PAGE_DATASET,
      range: { firstDay: '2026-08-01', lastDay: '2026-08-01' },
      pageRows: () => {
        // While the order is running, its run-log row must already belong to this chain.
        for (const r of runLogRows()) seen.push(String(r.job_name))
        return rows('2026-08-01', 1)
      },
    })
    await runPageDailyPull(h.step, d.deps, { ...BACKFILL, end_day: '2026-08-01' }, CTX)
    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen)).toEqual(new Set(['gsc-query-page-daily-pull']))
  })
})

interface FunctionOpts {
  id: string
  triggers: Array<{ cron?: string; event?: string }>
  onFailure: (ctx: { event: { data: { run_id: string }; ts: number }; error: Error }) => Promise<void>
}

function optsOf(fn: unknown): FunctionOpts {
  return (fn as { opts: FunctionOpts }).opts
}

describe('the production Inngest functions are wired to their own chain (added after the second review)', () => {
  it('🔴 each function listens to its own trigger and nobody else\'s', () => {
    expect(optsOf(gscQueryPageDailyPull).triggers).toEqual([{ event: 'gsc/query-page-daily.pull.due' }])
    expect(optsOf(gscPageDailyPull).triggers).toEqual([{ event: 'gsc/page-daily.pull.due' }])
    expect(optsOf(gscQueryPageDailyFanOut).triggers).toEqual([{ cron: `TZ=UTC ${GSC_QUERY_PAGE_DAILY_CRON}` }])
    expect(optsOf(gscPageDailyFanOut).triggers[0].cron).not.toBe(optsOf(gscQueryPageDailyFanOut).triggers[0].cron)
    expect(new Set([optsOf(gscPageDailyFanOut).id, optsOf(gscPageDailyPull).id, optsOf(gscQueryPageDailyFanOut).id, optsOf(gscQueryPageDailyPull).id]).size).toBe(4)
  })

  it('🔴 the pull worker carries the query-page data set; the dispatch plans from the query-page receipts with 4 backfill months', async () => {
    expect(QUERY_PAGE_PULL_DEPS.dataset).toBe(QUERY_PAGE_DATASET)
    fakeDb.tables.client_connectors = [{ client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: SITE } }]
    const plan = await queryPageFanOutDeps(supabaseAdmin).buildPlan('2026-10-13')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.orders.filter((o) => o.kind === 'daily')).toHaveLength(1)
    expect(plan.orders.filter((o) => o.kind === 'backfill')).toHaveLength(4)
    // a complete receipt in the PAGE receipts table must not count as coverage for this chain
    fakeDb.tables.gsc_page_fetch_receipts = [
      { id: crypto.randomUUID(), client_id: A, site_url: SITE, kind: 'backfill', request_start_day: '2026-09-01', request_end_day: '2026-09-30', data_through_day: '2026-09-30', status: 'complete', failure_kind: null, started_at: '2026-10-12T18:31:00Z' },
    ]
    const again = await queryPageFanOutDeps(supabaseAdmin).buildPlan('2026-10-13')
    expect(again.ok && again.orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-09-01')).toBe(true)
  })

  it('🔴 onFailure of the query-page functions closes the query-page run-log row and receipt', async () => {
    const runId = 'run-wire-1'
    const id = cronRunIdFromInngestRun(runId)
    fakeDb.tables.cron_run_logs = [
      { id, job_name: 'gsc-query-page-daily', status: 'running', started_at: new Date().toISOString() },
    ]
    await optsOf(gscQueryPageDailyFanOut).onFailure({ event: { data: { run_id: runId }, ts: Date.now() }, error: new Error('boom') })
    expect(fakeDb.tables.cron_run_logs[0].status).toBe('failed')
    // closing must not re-label the row as the other chain's job
    expect(fakeDb.tables.cron_run_logs[0].job_name).toBe('gsc-query-page-daily')

    const pullId = cronRunIdFromInngestRun('run-wire-2')
    fakeDb.tables.cron_run_logs = [
      { id: pullId, job_name: 'gsc-query-page-daily-pull', status: 'running', started_at: new Date().toISOString() },
    ]
    fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE] = [
      { id: pullId, client_id: A, site_url: SITE, kind: 'daily', request_start_day: '2026-10-01', request_end_day: '2026-10-05', status: 'running', started_at: new Date().toISOString() },
    ]
    await optsOf(gscQueryPageDailyPull).onFailure({ event: { data: { run_id: 'run-wire-2' }, ts: Date.now() }, error: new Error('[gsc:other] x') })
    expect(fakeDb.tables.cron_run_logs[0].status).toBe('failed')
    expect(fakeDb.tables.cron_run_logs[0].job_name).toBe('gsc-query-page-daily-pull')
    expect(fakeDb.tables[QUERY_PAGE_RECEIPTS_TABLE][0].status).toBe('failed')
  })
})
