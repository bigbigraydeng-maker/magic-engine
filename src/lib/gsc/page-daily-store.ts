/**
 * Database side of the per-page daily GSC store.
 *
 * Rules enforced here:
 * - Rows are upserted by (client_id, day, page_url) in batches of
 *   UPSERT_BATCH_SIZE, and every write result is checked: a failed write throws
 *   and is never counted as written.
 * - URLs or keys longer than MAX_URL_BYTES bytes are not written (btree index
 *   entry limit) and are counted instead.
 * - A receipt's id is the id of the same order's cron_run_logs row. Both are
 *   derived from the Inngest run id (cronRunIdFromInngestRun), so a failure
 *   handler can close exactly its own order's receipt and run log.
 *
 * No client names or ids live here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { gscPageKey } from '@/lib/url/page-key'
import type { GscAnalyticsRow, GscDayRange } from './client'
import { loadGscConnectedClients } from './connected-clients'
import {
  backfillWindowStart,
  planPageDailyPulls,
  type PagePlan,
  type PlanReceipt,
  type PullKind,
} from './page-daily-plan'

export const PAGE_DAILY_TABLE = 'gsc_page_daily'
export const PAGE_FETCH_RECEIPTS_TABLE = 'gsc_page_fetch_receipts'
export const UPSERT_BATCH_SIZE = 500
export const MAX_URL_BYTES = 2000

export type ReceiptStatus = 'running' | 'complete' | 'truncated' | 'failed'
export type FailureKind = 'auth' | 'quota' | 'other'

export interface PageDailyRow {
  readonly client_id: string
  readonly day: string
  readonly page_url: string
  readonly page_key: string
  readonly clicks: number
  readonly impressions: number
  readonly ctr: number
  readonly position: number
}

export interface OpenReceiptInput {
  readonly id: string
  readonly client_id: string
  readonly site_url: string
  readonly kind: PullKind
  readonly request_start_day: string
  readonly request_end_day: string
  readonly inngest_run_id: string | null
  readonly inngest_event_id: string | null
  readonly started_at: string
}

export interface CloseReceiptInput {
  readonly status: Exclude<ReceiptStatus, 'running'>
  readonly failure_kind: FailureKind | null
  readonly row_count: number
  readonly request_count: number
  readonly skipped_long_urls: number
  readonly error: string | null
}

export type PlanResult =
  | ({ readonly ok: true; readonly clients: number } & PagePlan)
  | { readonly ok: false; readonly reason: string }

/** Byte length of a string in UTF-8 (what a btree index entry limit counts). */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Turn one day's Search Analytics rows into storable rows, deduping by raw URL. */
export function toPageDailyRows(
  clientId: string,
  day: string,
  rows: readonly GscAnalyticsRow[],
): { rows: PageDailyRow[]; skippedLongUrls: number } {
  const byUrl = new Map<string, PageDailyRow>()
  let skippedLongUrls = 0

  for (const r of rows) {
    const pageUrl = r.keys[0]
    if (typeof pageUrl !== 'string' || pageUrl.length === 0) continue
    const pageKey = gscPageKey(pageUrl) ?? pageUrl
    if (utf8Bytes(pageUrl) > MAX_URL_BYTES || utf8Bytes(pageKey) > MAX_URL_BYTES) {
      skippedLongUrls += 1
      continue
    }
    byUrl.set(pageUrl, {
      client_id: clientId,
      day,
      page_url: pageUrl,
      page_key: pageKey,
      clicks: Math.round(r.clicks),
      impressions: Math.round(r.impressions),
      ctr: r.ctr,
      position: r.position,
    })
  }

  return { rows: [...byUrl.values()], skippedLongUrls }
}

/** Upsert one day's rows in batches; a failed batch throws and is never counted. */
export async function upsertPageDayRows(
  supabase: SupabaseClient,
  clientId: string,
  day: string,
  rows: readonly GscAnalyticsRow[],
): Promise<{ written: number; skippedLongUrls: number }> {
  const { rows: out, skippedLongUrls } = toPageDailyRows(clientId, day, rows)

  for (let i = 0; i < out.length; i += UPSERT_BATCH_SIZE) {
    const chunk = out.slice(i, i + UPSERT_BATCH_SIZE)
    const { error } = await supabase
      .from(PAGE_DAILY_TABLE)
      .upsert(chunk, { onConflict: 'client_id,day,page_url' })
    if (error) {
      throw new Error(`[db] ${PAGE_DAILY_TABLE} upsert failed for ${day}: ${error.message}`)
    }
  }

  return { written: out.length, skippedLongUrls }
}

/** Insert the running receipt for one order; a duplicate id means it already exists. */
export async function openReceipt(
  supabase: SupabaseClient,
  input: OpenReceiptInput,
  table: string = PAGE_FETCH_RECEIPTS_TABLE,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .insert({ ...input, status: 'running' })
  if (!error) return
  // An earlier attempt of the same step already inserted this receipt and only
  // the response was lost — the retry is a no-op, not a failure.
  if (error.code === '23505') return
  throw new Error(`[db] ${table} insert failed: ${error.message}`)
}

/** Record which days Google had finalised data for inside the requested range. */
export async function recordFinalizedRange(
  supabase: SupabaseClient,
  receiptId: string,
  range: GscDayRange,
  table: string = PAGE_FETCH_RECEIPTS_TABLE,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ data_from_day: range.firstDay, data_through_day: range.lastDay })
    .eq('id', receiptId)
  if (error) {
    throw new Error(`[db] ${table} update failed: ${error.message}`)
  }
}

/** Finish one receipt with its final status and counters. */
export async function closeReceipt(
  supabase: SupabaseClient,
  receiptId: string,
  input: CloseReceiptInput,
  now: Date = new Date(),
  table: string = PAGE_FETCH_RECEIPTS_TABLE,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ ...input, finished_at: now.toISOString() })
    .eq('id', receiptId)
  if (error) {
    throw new Error(`[db] ${table} update failed: ${error.message}`)
  }
}

/**
 * Fail ONE receipt if it is still running — the failure handler's half of "close exactly my own order".
 * Never throws (it runs inside a failure handler). Returns the receipt's started_at when it was closed here,
 * null when it was not running (already closed, or never opened) or the write failed.
 */
export async function closeReceiptIfRunning(
  supabase: SupabaseClient,
  receiptId: string,
  input: { failure_kind: FailureKind; error: string },
  now: Date = new Date(),
  table: string = PAGE_FETCH_RECEIPTS_TABLE,
): Promise<{ started_at: string } | null> {
  const { data, error } = await supabase
    .from(table)
    .update({ status: 'failed', failure_kind: input.failure_kind, error: input.error, finished_at: now.toISOString() })
    .eq('id', receiptId)
    .eq('status', 'running')
    .select('started_at')
  if (error) {
    console.error('[gsc/page-daily-store] closing the running receipt failed:', error.message)
    return null
  }
  const startedAt = (data ?? [])[0]?.started_at
  return typeof startedAt === 'string' ? { started_at: startedAt } : null
}

/** Validate one receipt row; a row with an unexpected shape is skipped, never guessed. */
export function toPlanReceipt(row: Record<string, unknown>): PlanReceipt | null {
  const { client_id, site_url, kind, status, failure_kind, request_start_day, request_end_day, data_through_day, started_at } = row
  if (
    typeof client_id !== 'string' ||
    typeof site_url !== 'string' ||
    typeof request_start_day !== 'string' ||
    typeof request_end_day !== 'string' ||
    typeof started_at !== 'string'
  ) {
    return null
  }
  if (kind !== 'daily' && kind !== 'backfill') return null
  if (status !== 'running' && status !== 'complete' && status !== 'truncated' && status !== 'failed') return null
  return {
    client_id,
    site_url,
    kind,
    status,
    failure_kind: failure_kind === 'auth' || failure_kind === 'quota' || failure_kind === 'other' ? failure_kind : null,
    request_start_day,
    request_end_day,
    data_through_day: typeof data_through_day === 'string' ? data_through_day : null,
    started_at,
  }
}

/**
 * Every receipt (any status) of the listed clients whose range ends inside the planning window, across pages.
 * The planner needs all of them: complete / truncated ones for coverage, failed ones for the stop rule, and
 * all of them for "when was the last dispatch".
 */
export async function loadPlanReceipts(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  sinceDay: string,
  table: string = PAGE_FETCH_RECEIPTS_TABLE,
): Promise<PlanReceipt[]> {
  if (clientIds.length === 0) return []
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase
      .from(table)
      .select('client_id, site_url, kind, status, failure_kind, request_start_day, request_end_day, data_through_day, started_at')
      .in('client_id', [...clientIds])
      .gte('request_end_day', sinceDay)
      .order('id', { ascending: true })
      .range(from, to),
  )
  return rows.flatMap((row) => {
    const r = toPlanReceipt(row)
    return r ? [r] : []
  })
}

/** Build one dispatch's plan (orders + stopped months), or report why it could not be built. */
/** Which receipts table and how many backfill months per dispatch; the page-level defaults are today's behaviour. */
export interface PlanOptions {
  readonly receiptsTable?: string
  readonly maxBackfillSegments?: number
}

export async function buildPageDailyPlan(
  supabase: SupabaseClient,
  today: string,
  options: PlanOptions = {},
): Promise<PlanResult> {
  const roster = await loadGscConnectedClients(supabase)
  if (!roster.ok) return { ok: false, reason: `roster: ${roster.reason}` }

  let receipts: PlanReceipt[]
  try {
    receipts = await loadPlanReceipts(
      supabase,
      roster.clients.map((c) => c.clientId),
      backfillWindowStart(today),
      options.receiptsTable,
    )
  } catch (err) {
    return { ok: false, reason: `receipts: ${err instanceof Error ? err.message : String(err)}` }
  }

  return { ok: true, clients: roster.clients.length, ...planPageDailyPulls(roster.clients, receipts, today, options.maxBackfillSegments) }
}
