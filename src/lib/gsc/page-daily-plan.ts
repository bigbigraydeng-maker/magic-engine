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
 *   not yet covered by a complete receipt, at most
 *   MAX_BACKFILL_SEGMENTS_PER_DISPATCH per client per dispatch, newest first.
 *
 * De-duplication is by receipts in the database, NOT by Inngest event ids:
 * Inngest only de-duplicates event ids for 24 hours. All days are Google's
 * dates (US Pacific time), 'YYYY-MM-DD' strings compared as strings. No client
 * names, ids or industry rules live here.
 */

import type { GscConnectedClient } from './connected-clients'

/** Cloud-only event name; the local factory-worker does not consume it (one event, one owner). */
export const GSC_PAGE_DAILY_PULL_EVENT = 'gsc/page-daily.pull.due'
/** cron_run_logs.job_name for the fan-out and for every pull order. Must equal the CRON_REGISTRY jobName. */
export const GSC_PAGE_DAILY_JOB = 'gsc-page-daily'
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

/** A `status = 'complete'` receipt, reduced to what coverage needs. */
export interface CoverageReceipt {
  readonly client_id: string
  readonly site_url: string
  readonly request_start_day: string
  readonly request_end_day: string
  readonly data_through_day: string | null
  readonly started_at: string
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
 * The last day this complete receipt vouches for, or null when it vouches for
 * nothing. Days after Google's last finalised day are only vouched for once
 * they are SETTLED_AFTER_DAYS old at the time of the pull (then "no data"
 * really means zero), so a pull that ran before a day was finalised never
 * counts as covering it.
 */
export function coveredThrough(r: CoverageReceipt): string | null {
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
export function isSegmentCovered(segment: DaySegment, receipts: readonly CoverageReceipt[]): boolean {
  const intervals = receipts.flatMap((r) => {
    const e = coveredThrough(r)
    return e ? [{ start: r.request_start_day, end: e }] : []
  })
  for (let d = segment.start_day; d <= segment.end_day; d = addDays(d, 1)) {
    if (!intervals.some((i) => i.start <= d && d <= i.end)) return false
  }
  return true
}

/** The pull orders for one dispatch: one daily order per client plus the uncovered backfill months. */
export function planPageDailyPulls(
  clients: readonly GscConnectedClient[],
  receipts: readonly CoverageReceipt[],
  today: string,
): PullOrder[] {
  const orders: PullOrder[] = []
  const segments = backfillSegments(today)
  for (const c of clients) {
    orders.push({
      client_id: c.clientId,
      kind: 'daily',
      start_day: addDays(today, -DAILY_WINDOW_DAYS),
      end_day: addDays(today, -1),
    })
    const own = receipts.filter((r) => r.client_id === c.clientId && r.site_url === c.siteUrl)
    const uncovered = segments
      .filter((s) => !isSegmentCovered(s, own))
      .slice(0, MAX_BACKFILL_SEGMENTS_PER_DISPATCH)
    for (const s of uncovered) {
      orders.push({ client_id: c.clientId, kind: 'backfill', start_day: s.start_day, end_day: s.end_day })
    }
  }
  return orders
}

/** Only a 24-hour de-dup key inside Inngest; the real de-dup is the receipt coverage above. */
export function pullEventId(order: PullOrder): string {
  return `gsc-page-daily:${order.client_id}:${order.kind}:${order.start_day}:${order.end_day}`
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
