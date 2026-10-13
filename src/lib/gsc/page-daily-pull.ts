/**
 * One pull ORDER for the per-page daily GSC store: either a daily "last 5 days"
 * window or one backfill month, for one client.
 *
 * The Inngest function `cloud-gsc-page-daily-pull` drives this module through the
 * narrow `PullStep` interface, so tests drive it with a fake step and no Inngest
 * internals.
 *
 * Step layout: `log-start` → `open-receipt` → `finalized-range` → `pull-<day>`
 * (plus `pull-<day>-p2` only when page 1 came back full) →
 * `close-receipt` → `log-finish`. One Google request per step, so no step can run
 * into the ~125 s gateway limit (docs/PITFALLS.md F8/F10). No step sleeps. Step
 * results carry counts only, never data rows.
 *
 * Error rules inside steps: HTTP 429 → `RetryAfterError` with Google's wait
 * (60 s when Google gives none); 401 (after the shared refresh-and-retry in
 * withGscAccess) / 403 / no usable token → `NonRetriableError` tagged
 * `[gsc:auth]`; 400 / 404 → `NonRetriableError` tagged `[gsc:other]`; anything
 * else (5xx, network, database write) → a plain Error so Inngest retries that step.
 *
 * When a step still fails (retries used up or non-retriable), the body catches
 * it, closes the receipt as failed with a failure_kind and writes the run log,
 * then RETURNS NORMALLY: rethrowing would make the function-level onFailure log
 * the same failure a second time.
 *
 * Run-log rule: truncated and failed orders count as failed in cron_run_logs
 * EXCEPT auth failures — the daily Google data pullback already reports GSC
 * authorisation errors, so an auth failure is only written on the receipt
 * (one alarm, not two).
 *
 * The receipt id IS the order's cron_run_logs id, and both are derived from the
 * Inngest run id (cronRunIdFromInngestRun). `handlePullFailure` (the
 * function-level onFailure) recomputes that id from `event.data.run_id` and
 * closes exactly this order's two rows — never other orders of the same job,
 * which may be running at the same moment. Retried steps get the same id, so
 * opening the run log and the receipt are both idempotent.
 *
 * Pull orders log under their own job name (GSC_PAGE_DAILY_PULL_JOB), apart
 * from the daily dispatch row.
 */

import { NonRetriableError, RetryAfterError } from 'inngest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cronRunHandle, cronRunIdFromInngestRun, finishCronRunIfOpen, startCronRunWithId } from '@/lib/cron/run-logger'
import { GscApiError, type GscAnalyticsRow, type GscDayRange, type GscRowsQuery } from './client'
import { addDays, GSC_PAGE_DAILY_PULL_JOB, type PullOrder } from './page-daily-plan'
import {
  PAGE_FETCH_RECEIPTS_TABLE,
  closeReceipt,
  closeReceiptIfRunning,
  openReceipt,
  recordFinalizedRange,
  upsertPageDayRows,
  type FailureKind,
} from './page-daily-store'

/** Google's per-request maximum; a page this full means there may be more. */
export const PAGE_ROW_LIMIT = 25_000
/**
 * Pages per day. Google's Search Analytics API exposes at most 50,000 rows per day per search type
 * (2 × 25,000 — developers.google.com/webmaster-tools/v1/how-tos/all-your-data). When page 2 also comes back
 * full, the day reached that cap: Google only gives its top rows, so the day is recorded as truncated.
 */
export const MAX_PAGES_PER_DAY = 2
/** Wait used when Google returns 429 without a usable Retry-After. */
export const DEFAULT_RETRY_AFTER_MS = 60_000

export interface PullStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

/**
 * What differs between per-page and per-(query, page) daily stores: the Search Analytics dimensions, the table the
 * rows go to, the receipts table, and the run-log job name. Absent in `PullDeps` = the per-page store, exactly as
 * before — existing callers and tests do not change.
 */
export interface PullDataset {
  readonly dimensions: readonly string[]
  readonly pullJob: string
  /**
   * Opens this data set's run-log row. A function of the data set (not `startCronRunWithId(dataset.pullJob, …)` at
   * the call site) because the CRON_REGISTRY coverage test reads job names from literal / top-level-constant
   * arguments — each data set therefore opens its own row with its own constant.
   */
  startRun(runLogId: string): Promise<void>
  readonly receiptsTable: string
  upsertDay(
    supabase: SupabaseClient,
    clientId: string,
    day: string,
    rows: readonly GscAnalyticsRow[],
  ): Promise<{ written: number; skippedLongUrls: number }>
}

export const PAGE_DATASET: PullDataset = {
  dimensions: ['page'],
  pullJob: GSC_PAGE_DAILY_PULL_JOB,
  startRun: (runLogId) => startCronRunWithId(GSC_PAGE_DAILY_PULL_JOB, runLogId),
  receiptsTable: PAGE_FETCH_RECEIPTS_TABLE,
  upsertDay: upsertPageDayRows,
}

export interface PullDeps {
  readonly supabase: SupabaseClient
  /** Which store this pull feeds; the per-page store when absent. */
  readonly dataset?: PullDataset
  /** The client's current GSC property, or null when it is no longer connected. */
  loadSiteUrl(clientId: string): Promise<string | null>
  /** Rows for one query; null when no usable token exists. May throw GscApiError. */
  fetchRows(clientId: string, siteUrl: string, query: GscRowsQuery): Promise<GscAnalyticsRow[] | null>
  /** First / last finalised day inside the range; null when no usable token exists. May throw GscApiError. */
  fetchFinalizedRange(clientId: string, siteUrl: string, startDay: string, endDay: string): Promise<GscDayRange | null>
}

export interface PullContext {
  readonly runId: string
  readonly eventId: string | null
}

export interface PullOutcome {
  readonly receipt_id: string | null
  readonly client_id: string
  readonly kind: PullOrder['kind']
  readonly request_start_day: string
  readonly request_end_day: string
  readonly status: 'complete' | 'truncated' | 'failed' | 'skipped'
  readonly failure_kind: FailureKind | null
  readonly data_from_day: string | null
  readonly data_through_day: string | null
  readonly days_pulled: number
  readonly truncated_days: readonly string[]
  readonly row_count: number
  readonly request_count: number
  readonly skipped_long_urls: number
  readonly slowest_step_ms: number
  readonly no_publish: true
  readonly error: string | null
}

/** Map a thrown value to the error Inngest should see for this step. */
export function toStepError(err: unknown): Error {
  if (err instanceof GscApiError) {
    const detail = `${err.httpStatus} ${err.googleReason || err.googleStatus} ${err.message}`.trim()
    if (err.httpStatus === 429) {
      const wait = err.retryAfterMs !== null && err.retryAfterMs > 0 ? err.retryAfterMs : DEFAULT_RETRY_AFTER_MS
      return new RetryAfterError(`[gsc:quota] ${detail}`, wait)
    }
    if (err.httpStatus === 401 || err.httpStatus === 403) return new NonRetriableError(`[gsc:auth] ${detail}`)
    if (err.httpStatus === 400 || err.httpStatus === 404) return new NonRetriableError(`[gsc:other] ${detail}`)
    return new Error(`[gsc:other] ${detail}`)
  }
  return err instanceof Error ? err : new Error(String(err))
}

/** Classify a failure message; works on the original error and on Inngest's StepError. */
export function failureKindOf(message: string): FailureKind {
  if (message.includes('[gsc:auth]')) return 'auth'
  if (message.includes('[gsc:quota]')) return 'quota'
  return 'other'
}

/** The days of an order that Google has finalised data for, in order. */
export function daysToPull(order: PullOrder, range: GscDayRange): string[] {
  if (range.firstDay === null || range.lastDay === null) return []
  const start = range.firstDay > order.start_day ? range.firstDay : order.start_day
  const end = range.lastDay < order.end_day ? range.lastDay : order.end_day
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
}

/** True when this outcome should count as a failure in cron_run_logs (auth is reported elsewhere). */
export function countsAsRunFailure(outcome: Pick<PullOutcome, 'status' | 'failure_kind'>): boolean {
  return outcome.status === 'truncated' || (outcome.status === 'failed' && outcome.failure_kind !== 'auth')
}

function noTokenError(): NonRetriableError {
  return new NonRetriableError('[gsc:auth] no usable GSC token for this client')
}

interface PageResult {
  rows: number
  skippedLongUrls: number
  full: boolean
  ms: number
}

/** Fetch and store one page of one day; database errors stay plain (retriable). */
async function pullPage(
  deps: PullDeps,
  clientId: string,
  siteUrl: string,
  day: string,
  page: number,
): Promise<PageResult> {
  const t0 = Date.now()
  const dataset = deps.dataset ?? PAGE_DATASET
  let rows: GscAnalyticsRow[] | null
  try {
    rows = await deps.fetchRows(clientId, siteUrl, {
      startDate: day,
      endDate: day,
      dimensions: dataset.dimensions,
      rowLimit: PAGE_ROW_LIMIT,
      startRow: (page - 1) * PAGE_ROW_LIMIT,
    })
  } catch (err) {
    throw toStepError(err)
  }
  if (rows === null) throw noTokenError()
  const written = await dataset.upsertDay(deps.supabase, clientId, day, rows)
  return {
    rows: written.written,
    skippedLongUrls: written.skippedLongUrls,
    full: rows.length >= PAGE_ROW_LIMIT,
    ms: Date.now() - t0,
  }
}

interface DayResult {
  rows: number
  skippedLongUrls: number
  requests: number
  truncated: boolean
  slowestMs: number
}

/** Pull one day, following a full page with the next one up to the page cap. */
async function pullDay(
  step: PullStep,
  deps: PullDeps,
  clientId: string,
  siteUrl: string,
  day: string,
): Promise<DayResult> {
  const acc: DayResult = { rows: 0, skippedLongUrls: 0, requests: 0, truncated: false, slowestMs: 0 }
  for (let page = 1; page <= MAX_PAGES_PER_DAY; page += 1) {
    const id = page === 1 ? `pull-${day}` : `pull-${day}-p${page}`
    const r = await step.run(id, () => pullPage(deps, clientId, siteUrl, day, page))
    acc.rows += r.rows
    acc.skippedLongUrls += r.skippedLongUrls
    acc.requests += 1
    acc.slowestMs = Math.max(acc.slowestMs, r.ms)
    if (!r.full) return acc
    if (page === MAX_PAGES_PER_DAY) acc.truncated = true
  }
  return acc
}

interface RangeResult {
  range: GscDayRange | null
  daysPulled: number
  truncatedDays: string[]
  rows: number
  skippedLongUrls: number
  requests: number
  slowestMs: number
  failure: { kind: FailureKind; message: string } | null
}

/** Pull every finalised day of the order; a failure keeps the counts done so far. */
async function pullRange(
  step: PullStep,
  deps: PullDeps,
  order: PullOrder,
  siteUrl: string,
  receiptId: string,
): Promise<RangeResult> {
  const acc: RangeResult = {
    range: null,
    daysPulled: 0,
    truncatedDays: [],
    rows: 0,
    skippedLongUrls: 0,
    requests: 0,
    slowestMs: 0,
    failure: null,
  }
  try {
    const range = await step.run('finalized-range', async () => {
      const t0 = Date.now()
      let r: GscDayRange | null
      try {
        r = await deps.fetchFinalizedRange(order.client_id, siteUrl, order.start_day, order.end_day)
      } catch (err) {
        throw toStepError(err)
      }
      if (r === null) throw noTokenError()
      await recordFinalizedRange(deps.supabase, receiptId, r, (deps.dataset ?? PAGE_DATASET).receiptsTable)
      return { firstDay: r.firstDay, lastDay: r.lastDay, ms: Date.now() - t0 }
    })
    acc.range = { firstDay: range.firstDay, lastDay: range.lastDay }
    acc.requests += 1
    acc.slowestMs = Math.max(acc.slowestMs, range.ms)

    for (const day of daysToPull(order, acc.range)) {
      const d = await pullDay(step, deps, order.client_id, siteUrl, day)
      acc.daysPulled += 1
      acc.rows += d.rows
      acc.skippedLongUrls += d.skippedLongUrls
      acc.requests += d.requests
      acc.slowestMs = Math.max(acc.slowestMs, d.slowestMs)
      if (d.truncated) acc.truncatedDays.push(day)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    acc.failure = { kind: failureKindOf(message), message }
  }
  return acc
}

/** The receipt status and error text for a finished range. */
function statusOf(r: RangeResult): { status: 'complete' | 'truncated' | 'failed'; error: string | null } {
  if (r.failure) return { status: 'failed', error: r.failure.message }
  if (r.truncatedDays.length > 0) {
    return {
      status: 'truncated',
      error: `${r.truncatedDays.length} day(s) reached Google's 50,000-rows-per-day cap (only Google's top rows are stored): ${r.truncatedDays.join(', ')}`,
    }
  }
  return { status: 'complete', error: null }
}

/** The cron_run_logs finish options for an outcome (auth failures are not run failures). */
function runLogFinishOpts(outcome: PullOutcome): {
  processed: number
  completed: number
  failed: number
  summary: Record<string, unknown>
  error?: string
} {
  const failed = countsAsRunFailure(outcome)
  return {
    processed: 1,
    completed: failed ? 0 : 1,
    failed: failed ? 1 : 0,
    summary: { ...outcome },
    error: failed ? (outcome.error ?? outcome.status) : undefined,
  }
}

/** Build the outcome for an order that was skipped because the client is gone. */
function skippedOutcome(order: PullOrder): PullOutcome {
  return {
    receipt_id: null,
    client_id: order.client_id,
    kind: order.kind,
    request_start_day: order.start_day,
    request_end_day: order.end_day,
    status: 'skipped',
    failure_kind: null,
    data_from_day: null,
    data_through_day: null,
    days_pulled: 0,
    truncated_days: [],
    row_count: 0,
    request_count: 0,
    skipped_long_urls: 0,
    slowest_step_ms: 0,
    no_publish: true,
    error: 'client_not_connected',
  }
}

/** Build the outcome for an order that ran (or failed) against a connected client. */
function pulledOutcome(
  order: PullOrder,
  receiptId: string,
  r: RangeResult,
): PullOutcome & { readonly status: 'complete' | 'truncated' | 'failed' } {
  const { status, error } = statusOf(r)
  return {
    receipt_id: receiptId,
    client_id: order.client_id,
    kind: order.kind,
    request_start_day: order.start_day,
    request_end_day: order.end_day,
    status,
    failure_kind: r.failure?.kind ?? null,
    data_from_day: r.range?.firstDay ?? null,
    data_through_day: r.range?.lastDay ?? null,
    days_pulled: r.daysPulled,
    truncated_days: r.truncatedDays,
    row_count: r.rows,
    request_count: r.requests,
    skipped_long_urls: r.skippedLongUrls,
    slowest_step_ms: r.slowestMs,
    no_publish: true,
    error,
  }
}

/** The `open-receipt` step: resolve the client's GSC property and open this order's receipt. */
function openReceiptStep(
  step: PullStep,
  deps: PullDeps,
  order: PullOrder,
  ctx: PullContext,
  started: { runLogId: string; startedAt: number },
): Promise<{ siteUrl: string | null }> {
  return step.run('open-receipt', async (): Promise<{ siteUrl: string | null }> => {
    const siteUrl = await deps.loadSiteUrl(order.client_id)
    if (!siteUrl) return { siteUrl: null }
    await openReceipt(
      deps.supabase,
      {
        id: started.runLogId,
        client_id: order.client_id,
        site_url: siteUrl,
        kind: order.kind,
        request_start_day: order.start_day,
        request_end_day: order.end_day,
        inngest_run_id: ctx.runId,
        inngest_event_id: ctx.eventId,
        started_at: new Date(started.startedAt).toISOString(),
      },
      (deps.dataset ?? PAGE_DATASET).receiptsTable,
    )
    return { siteUrl }
  })
}

/** The `close-receipt` step: write the final status and counters onto the receipt. */
function closeReceiptStep(
  step: PullStep,
  deps: PullDeps,
  receiptId: string,
  outcome: PullOutcome & { readonly status: 'complete' | 'truncated' | 'failed' },
): Promise<null> {
  return step.run('close-receipt', async () => {
    await closeReceipt(deps.supabase, receiptId, {
      status: outcome.status,
      failure_kind: outcome.failure_kind,
      row_count: outcome.row_count,
      request_count: outcome.request_count,
      skipped_long_urls: outcome.skipped_long_urls,
      error: outcome.error,
    }, new Date(), (deps.dataset ?? PAGE_DATASET).receiptsTable)
    return null
  })
}

/** Run one pull order end to end; never throws once a step has failed. */
export async function runPageDailyPull(
  step: PullStep,
  deps: PullDeps,
  order: PullOrder,
  ctx: PullContext,
): Promise<PullOutcome> {
  // The id is derived from the Inngest run id, so onFailure can find this exact row (and receipt) again.
  const started = await step.run('log-start', async () => {
    const runLogId = cronRunIdFromInngestRun(ctx.runId)
    await (deps.dataset ?? PAGE_DATASET).startRun(runLogId)
    return { runLogId, startedAt: Date.now() }
  })

  const opened = await openReceiptStep(step, deps, order, ctx, started)

  const finish = async (outcome: PullOutcome): Promise<PullOutcome> => {
    await step.run('log-finish', async () => {
      await cronRunHandle((deps.dataset ?? PAGE_DATASET).pullJob, started.runLogId, started.startedAt).finish(
        runLogFinishOpts(outcome),
      )
      return null
    })
    return outcome
  }

  if (opened.siteUrl === null) return finish(skippedOutcome(order))

  const r = await pullRange(step, deps, order, opened.siteUrl, started.runLogId)
  const outcome = pulledOutcome(order, started.runLogId, r)

  await closeReceiptStep(step, deps, started.runLogId, outcome)

  return finish(outcome)
}

/**
 * Function-level onFailure: close exactly this run's receipt and run-log row — both carry the id derived from
 * the Inngest run id — and nothing else. Other orders of the same job may be running at the same moment, so
 * nothing here closes rows by job name. Never throws.
 */
export async function handlePullFailure(
  supabase: SupabaseClient,
  input: { runId: string | null; message: string; failedAt: Date },
  dataset: PullDataset = PAGE_DATASET,
): Promise<{ receiptClosed: boolean; runLog: 'closed' | 'already_terminal' | 'no_run_id' }> {
  if (!input.runId) {
    console.error('[gsc/page-daily-pull] onFailure without a run id — nothing closed:', input.message)
    return { receiptClosed: false, runLog: 'no_run_id' }
  }
  const id = cronRunIdFromInngestRun(input.runId)
  const kind = failureKindOf(input.message)
  const error = `retries exhausted: ${input.message}`
  const receipt = await closeReceiptIfRunning(
    supabase,
    id,
    { failure_kind: kind, error },
    new Date(),
    dataset.receiptsTable,
  )
  const receiptStartMs = receipt ? Date.parse(receipt.started_at) : Number.NaN
  const failed = kind !== 'auth'
  const runLog = await finishCronRunIfOpen(
    dataset.pullJob,
    id,
    {
      processed: 1,
      completed: failed ? 0 : 1,
      failed: failed ? 1 : 0,
      summary: { receipt_id: receipt ? id : null, status: 'failed', failure_kind: kind, closed_by: 'onFailure', no_publish: true },
      error: failed ? error : undefined,
    },
    Number.isNaN(receiptStartMs) ? input.failedAt : new Date(receiptStartMs),
  )
  return { receiptClosed: receipt !== null, runLog }
}
