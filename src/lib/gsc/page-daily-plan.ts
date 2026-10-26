/**
 * Planning for the per-page daily Google Search Console store
 * (`gsc_page_daily` / `gsc_page_fetch_receipts`).
 *
 * A daily Inngest fan-out calls `planPageDailyPulls` and sends one event per
 * order; a pull function does the actual work. There are two kinds of order:
 *
 * - `daily`: the last DAILY_WINDOW_DAYS days (today excluded) for every
 *   connected client, every day. Each day is requested on several consecutive
 *   days, so it gets fetched once Google has finalised it (usually 2-3 days).
 * - `backfill`: one calendar month of the last BACKFILL_MONTHS months that is
 *   not yet covered by a complete or truncated receipt, at most
 *   MAX_BACKFILL_SEGMENTS_PER_DISPATCH per client per dispatch, newest first.
 *   A month whose latest BACKFILL_STOP_AFTER_FAILURES receipts are all
 *   non-auth failures is no longer dispatched ("stopped"); it is reported in
 *   every dispatch's run log instead (see planPageDailyPulls).
 *
 * De-duplication is by receipts in the database, NOT by Inngest event ids:
 * Inngest only de-duplicates event ids for 24 hours. All days are Google's
 * dates (US Pacific time), 'YYYY-MM-DD' strings compared as strings. No client
 * names, ids or industry rules live here.
 */

import type { GscConnectedClient } from './connected-clients'

/** Cloud-only event name; the local factory-worker does not consume it (one event, one owner). */
export const GSC_PAGE_DAILY_PULL_EVENT = 'gsc/page-daily.pull.due'
/** cron_run_logs.job_name for the fan-out (the daily dispatch row). Must equal its CRON_REGISTRY jobName. */
export const GSC_PAGE_DAILY_JOB = 'gsc-page-daily'
/**
 * cron_run_logs.job_name for each pull order. Kept apart from the dispatch row: the health check only reads a
 * job's newest row, so sharing one name let the last order hide an earlier failure (and the dispatch's own report).
 * Must equal its CRON_REGISTRY jobName.
 */
export const GSC_PAGE_DAILY_PULL_JOB = 'gsc-page-daily-pull'
/**
 * The ONLY definition of the fan-out schedule: the Inngest cron trigger and CRON_REGISTRY both read it
 * (the registry test asserts they are equal). 18:30 UTC daily = after google-data-pullback-daily (17:00 UTC).
 */
export const GSC_PAGE_DAILY_CRON = '30 18 * * *'
export const GSC_PAGE_DAILY_TZ = 'UTC'
/** Google Search Console reports dates in US Pacific time. */
export const GSC_DATE_TZ = 'America/Los_Angeles'
/** A daily order covers the last N days, today excluded. */
export const DAILY_WINDOW_DAYS = 5
/** Calendar months covered by the backfill (Google keeps about 16 months). */
export const BACKFILL_MONTHS = 16
/** Backfill orders per client per dispatch: the history fills in a few months per day, not all at once. */
export const MAX_BACKFILL_SEGMENTS_PER_DISPATCH = 3
/** A backfill month whose latest this-many receipts are all failed (failure_kind other than auth) is no longer dispatched. */
export const BACKFILL_STOP_AFTER_FAILURES = 3
/** A day at least this many days older than the pull that asked for it counts as settled even if Google returned no data for it. */
export const SETTLED_AFTER_DAYS = 5
/** Longest range one order may ask for (a calendar month) — bounds the number of steps per run. */
export const MAX_ORDER_DAYS = 31

export type PullKind = 'daily' | 'backfill'

export interface PullOrder {
  readonly client_id: string
  readonly kind: PullKind
  readonly start_day: string
  readonly end_day: string
}

export type PlanReceiptStatus = 'running' | 'complete' | 'truncated' | 'failed'
export type PlanFailureKind = 'auth' | 'quota' | 'other'

/** A receipt as the planner needs it (any status). */
export interface PlanReceipt {
  readonly client_id: string
  readonly site_url: string
  readonly kind: PullKind
  readonly status: PlanReceiptStatus
  readonly failure_kind: PlanFailureKind | null
  readonly request_start_day: string
  readonly request_end_day: string
  readonly data_through_day: string | null
  readonly started_at: string
}

/**
 * A backfill month that is no longer dispatched. `month` is 'YYYY-MM'; `stopped_on` is the Pacific date of the
 * receipt that brought the streak of consecutive non-auth failures to BACKFILL_STOP_AFTER_FAILURES.
 */
export interface StoppedMonth {
  readonly client_id: string
  readonly month: string
  readonly stopped_on: string
}

/** One dispatch's plan. */
export interface PagePlan {
  readonly orders: readonly PullOrder[]
  /** Every month that is currently stopped — reported in every dispatch's run-log summary. */
  readonly stopped: readonly StoppedMonth[]
  /** The stopped months this dispatch is the first to see — the dispatch reports failed for these, once. */
  readonly newlyStopped: readonly StoppedMonth[]
}

export interface DaySegment {
  readonly start_day: string
  readonly end_day: string
}

export type ParsedPullDue =
  | { readonly ok: true; readonly value: PullOrder }
  | { readonly ok: false; readonly reason: string }

/** The US Pacific calendar day of an instant, as 'YYYY-MM-DD'. */
export function pacificDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: GSC_DATE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Shift a 'YYYY-MM-DD' day by n days (n may be negative). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The first day of the calendar month containing `day`. */
export function monthStart(day: string): string {
  return day.slice(0, 8) + '01'
}

/** The last day of the calendar month containing `day`. */
export function monthEnd(day: string): string {
  const [y, m] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** Shift a first-of-month day by n calendar months (n may be negative). */
export function addMonths(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)
}

/** Number of days in the inclusive range start..end. */
export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000) + 1
}

/** True when value is a 'YYYY-MM-DD' string naming a real calendar date. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value
}

/** The oldest first-of-month the backfill reaches, given today's day. */
export function backfillWindowStart(today: string): string {
  return addMonths(monthStart(today), -(BACKFILL_MONTHS - 1))
}

/** The backfill segments to consider, newest month first, clipped before the daily window. */
export function backfillSegments(today: string): DaySegment[] {
  const horizon = addDays(today, -(DAILY_WINDOW_DAYS + 1))
  const oldest = backfillWindowStart(today)
  const segments: DaySegment[] = []
  for (let m = monthStart(today); m >= oldest; m = addMonths(m, -1)) {
    const start = m
    const end = monthEnd(m) < horizon ? monthEnd(m) : horizon
    if (end >= start) segments.push({ start_day: start, end_day: end })
  }
  return segments
}

/**
 * The last day this receipt vouches for, or null when it vouches for nothing. Only complete and truncated
 * receipts vouch: truncated means Google's own 50,000-rows-per-day export cap was reached, so re-pulling that
 * range cannot return more rows. Days after Google's last finalised day are only vouched for once
 * they are SETTLED_AFTER_DAYS old at the time of the pull (then "no data"
 * really means zero), so a pull that ran before a day was finalised never
 * counts as covering it.
 */
export function coveredThrough(r: PlanReceipt): string | null {
  if (r.status !== 'complete' && r.status !== 'truncated') return null
  const startedMs = Date.parse(r.started_at)
  const settled = Number.isNaN(startedMs) ? null : addDays(pacificDay(new Date(startedMs)), -SETTLED_AFTER_DAYS)
  const vouched =
    r.data_through_day === null
      ? settled
      : settled === null
        ? r.data_through_day
        : r.data_through_day > settled
          ? r.data_through_day
          : settled
  if (vouched === null) return null
  const end = vouched < r.request_end_day ? vouched : r.request_end_day
  return end >= r.request_start_day ? end : null
}

/** True when every day of the segment is inside some receipt's covered interval. */
export function isSegmentCovered(segment: DaySegment, receipts: readonly PlanReceipt[]): boolean {
  const intervals = receipts.flatMap((r) => {
    const e = coveredThrough(r)
    return e ? [{ start: r.request_start_day, end: e }] : []
  })
  for (let d = segment.start_day; d <= segment.end_day; d = addDays(d, 1)) {
    if (!intervals.some((i) => i.start <= d && d <= i.end)) return false
  }
  return true
}

/** One backfill month's receipts (same client + GSC property), newest first; in-flight and undated ones skipped. */
export function monthHistory(
  receipts: readonly PlanReceipt[],
  clientId: string,
  siteUrl: string,
  monthStartDay: string,
): PlanReceipt[] {
  return receipts
    .filter(
      (r) =>
        r.client_id === clientId &&
        r.site_url === siteUrl &&
        r.kind === 'backfill' &&
        r.request_start_day === monthStartDay &&
        r.status !== 'running' &&
        !Number.isNaN(Date.parse(r.started_at)),
    )
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
}

/**
 * When the newest receipts of a month (newest first) are at least BACKFILL_STOP_AFTER_FAILURES consecutive
 * failures whose failure_kind is not auth: the Pacific date of the receipt that brought that streak to
 * BACKFILL_STOP_AFTER_FAILURES. Otherwise null.
 *
 * An auth failure, a complete or a truncated receipt ends the streak: auth problems are fixed by reconnecting
 * (and are already reported by the daily Google data pullback), and a month that got data is not stuck.
 */
export function stoppedOnFor(history: readonly PlanReceipt[]): string | null {
  let streak = 0
  for (const r of history) {
    if (r.status === 'failed' && r.failure_kind !== 'auth') streak += 1
    else break
  }
  if (streak < BACKFILL_STOP_AFTER_FAILURES) return null
  const trigger = history[streak - BACKFILL_STOP_AFTER_FAILURES]
  return pacificDay(new Date(Date.parse(trigger.started_at)))
}

/**
 * The Pacific date of the most recent dispatch seen in the receipts (every dispatch pulls each connected
 * client's daily window, so every dispatch leaves receipts), or null when there are none.
 */
export function lastDispatchDay(receipts: readonly PlanReceipt[]): string | null {
  let last: string | null = null
  for (const r of receipts) {
    const ms = Date.parse(r.started_at)
    if (Number.isNaN(ms)) continue
    const day = pacificDay(new Date(ms))
    if (last === null || day > last) last = day
  }
  return last
}

/** One client's orders: its daily window, then up to MAX_BACKFILL_SEGMENTS_PER_DISPATCH uncovered, unstopped months. */
function planClient(
  c: GscConnectedClient,
  own: readonly PlanReceipt[],
  segments: readonly DaySegment[],
  today: string,
  maxBackfillSegments: number,
): { orders: PullOrder[]; stopped: StoppedMonth[] } {
  const orders: PullOrder[] = [
    { client_id: c.clientId, kind: 'daily', start_day: addDays(today, -DAILY_WINDOW_DAYS), end_day: addDays(today, -1) },
  ]
  const stopped: StoppedMonth[] = []
  const candidates: DaySegment[] = []
  for (const s of segments) {
    if (isSegmentCovered(s, own)) continue
    const stoppedOn = stoppedOnFor(monthHistory(own, c.clientId, c.siteUrl, s.start_day))
    if (stoppedOn) stopped.push({ client_id: c.clientId, month: s.start_day.slice(0, 7), stopped_on: stoppedOn })
    else candidates.push(s)
  }
  for (const s of candidates.slice(0, maxBackfillSegments)) {
    orders.push({ client_id: c.clientId, kind: 'backfill', start_day: s.start_day, end_day: s.end_day })
  }
  return { orders, stopped }
}

/**
 * One dispatch's plan: every client's daily window plus its uncovered, unstopped backfill months, and the list
 * of stopped months.
 *
 * "Newly stopped" timing: a dispatch runs BEFORE the pulls it sends, so the pull that makes a month's third
 * failure is only visible to the NEXT dispatch. A stopped month is new when its stopped_on is on or after the
 * most recent dispatch seen in the receipts (normally yesterday). Comparing with the last dispatch — not with
 * "yesterday" — means a skipped dispatch day does not lose the report. Everything is derived from receipts;
 * nothing is stored.
 */
export function planPageDailyPulls(
  clients: readonly GscConnectedClient[],
  receipts: readonly PlanReceipt[],
  today: string,
  maxBackfillSegments: number = MAX_BACKFILL_SEGMENTS_PER_DISPATCH,
): PagePlan {
  const segments = backfillSegments(today)
  const orders: PullOrder[] = []
  const stopped: StoppedMonth[] = []
  for (const c of clients) {
    const own = receipts.filter((r) => r.client_id === c.clientId && r.site_url === c.siteUrl)
    const planned = planClient(c, own, segments, today, maxBackfillSegments)
    orders.push(...planned.orders)
    stopped.push(...planned.stopped)
  }
  const last = lastDispatchDay(receipts)
  const newlyStopped = last === null ? [] : stopped.filter((s) => s.stopped_on >= last)
  return { orders, stopped, newlyStopped }
}

/** Only a 24-hour de-dup key inside Inngest; the real de-dup is the receipt coverage above. */
export function pullEventId(order: PullOrder, prefix: string = 'gsc-page-daily'): string {
  return `${prefix}:${order.client_id}:${order.kind}:${order.start_day}:${order.end_day}`
}

/** Validate an untrusted pull-due payload, fail-closed, in a fixed order. */
export function parsePullDue(raw: unknown): ParsedPullDue {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload_not_object' }
  const d = raw as Record<string, unknown>
  const clientId = d.client_id
  if (
    typeof clientId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)
  ) {
    return { ok: false, reason: 'invalid_client_id' }
  }
  const kind = d.kind
  if (kind !== 'daily' && kind !== 'backfill') return { ok: false, reason: 'invalid_kind' }
  const startDay = d.start_day
  const endDay = d.end_day
  if (!isIsoDay(startDay) || !isIsoDay(endDay)) return { ok: false, reason: 'invalid_day' }
  if (startDay > endDay) return { ok: false, reason: 'invalid_range' }
  if (daysBetweenInclusive(startDay, endDay) > MAX_ORDER_DAYS) return { ok: false, reason: 'range_too_long' }
  return { ok: true, value: { client_id: clientId, kind, start_day: startDay, end_day: endDay } }
}
