/**
 * Database side of the per-page daily GSC store.
 *
 * Rules enforced here:
 * - Rows are upserted by (client_id, day, page_url) in batches of
 *   UPSERT_BATCH_SIZE, and every write result is checked: a failed write throws
 *   and is never counted as written.
 * - URLs or keys longer than MAX_URL_BYTES bytes are not written (btree index
 *   entry limit) and are counted instead.
 * - A receipt's id is the id of the same order's cron_run_logs row, so the two
 *   can be joined without a second lookup.
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
  type CoverageReceipt,
  type PullKind,
  type PullOrder,
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
  | { readonly ok: true; readonly orders: readonly PullOrder[]; readonly clients: number }
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
export async function openReceipt(supabase: SupabaseClient, input: OpenReceiptInput): Promise<void> {
  const { error } = await supabase
    .from(PAGE_FETCH_RECEIPTS_TABLE)
    .insert({ ...input, status: 'running' })
  if (!error) return
  // An earlier attempt of the same step already inserted this receipt and only
  // the response was lost — the retry is a no-op, not a failure.
  if (error.code === '23505') return
  throw new Error(`[db] ${PAGE_FETCH_RECEIPTS_TABLE} insert failed: ${error.message}`)
}

/** Record which days Google had finalised data for inside the requested range. */
export async function recordFinalizedRange(
  supabase: SupabaseClient,
  receiptId: string,
  range: GscDayRange,
): Promise<void> {
  const { error } = await supabase
    .from(PAGE_FETCH_RECEIPTS_TABLE)
    .update({ data_from_day: range.firstDay, data_through_day: range.lastDay })
    .eq('id', receiptId)
  if (error) {
    throw new Error(`[db] ${PAGE_FETCH_RECEIPTS_TABLE} update failed: ${error.message}`)
  }
}

/** Finish one receipt with its final status and counters. */
export async function closeReceipt(
  supabase: SupabaseClient,
  receiptId: string,
  input: CloseReceiptInput,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await supabase
    .from(PAGE_FETCH_RECEIPTS_TABLE)
    .update({ ...input, finished_at: now.toISOString() })
    .eq('id', receiptId)
  if (error) {
    throw new Error(`[db] ${PAGE_FETCH_RECEIPTS_TABLE} update failed: ${error.message}`)
  }
}

/** Fail every still-running receipt of a run; never throws (runs in a failure handler). */
export async function closeRunningReceiptsForRun(
  supabase: SupabaseClient,
  inngestRunId: string,
  input: { failure_kind: FailureKind; error: string },
  now: Date = new Date(),
): Promise<Array<{ id: string; started_at: string }>> {
  const { data, error } = await supabase
    .from(PAGE_FETCH_RECEIPTS_TABLE)
    .update({
      status: 'failed',
      failure_kind: input.failure_kind,
      error: input.error,
      finished_at: now.toISOString(),
    })
    .eq('inngest_run_id', inngestRunId)
    .eq('status', 'running')
    .select('id, started_at')

  if (error) {
    console.error('[gsc/page-daily-store] closing running receipts failed:', error.message)
    return []
  }

  return (data ?? []).flatMap((row) => {
    const id = row.id
    const startedAt = row.started_at
    if (typeof id !== 'string' || typeof startedAt !== 'string') return []
    return [{ id, started_at: startedAt }]
  })
}

/** Load the complete receipts that can vouch for coverage, across all pages. */
export async function loadCoverageReceipts(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  sinceDay: string,
): Promise<CoverageReceipt[]> {
  if (clientIds.length === 0) return []

  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabase
      .from(PAGE_FETCH_RECEIPTS_TABLE)
      .select('client_id, site_url, request_start_day, request_end_day, data_through_day, started_at')
      .in('client_id', [...clientIds])
      .eq('status', 'complete')
      .gte('request_end_day', sinceDay)
      .order('id', { ascending: true })
      .range(from, to),
  )

  return rows.flatMap((row): CoverageReceipt[] => {
    const clientId = row.client_id
    const siteUrl = row.site_url
    const startDay = row.request_start_day
    const endDay = row.request_end_day
    const startedAt = row.started_at
    if (
      typeof clientId !== 'string' ||
      typeof siteUrl !== 'string' ||
      typeof startDay !== 'string' ||
      typeof endDay !== 'string' ||
      typeof startedAt !== 'string'
    ) {
      return []
    }
    const through = row.data_through_day
    return [
      {
        client_id: clientId,
        site_url: siteUrl,
        request_start_day: startDay,
        request_end_day: endDay,
        data_through_day: typeof through === 'string' ? through : null,
        started_at: startedAt,
      },
    ]
  })
}

/** Build one dispatch's pull orders, or report why the plan could not be built. */
export async function buildPageDailyPlan(
  supabase: SupabaseClient,
  today: string,
): Promise<PlanResult> {
  const roster = await loadGscConnectedClients(supabase)
  if (!roster.ok) return { ok: false, reason: `roster: ${roster.reason}` }

  let receipts: CoverageReceipt[]
  try {
    receipts = await loadCoverageReceipts(
      supabase,
      roster.clients.map((c) => c.clientId),
      backfillWindowStart(today),
    )
  } catch (err) {
    return { ok: false, reason: `receipts: ${err instanceof Error ? err.message : String(err)}` }
  }

  return {
    ok: true,
    orders: planPageDailyPulls(roster.clients, receipts, today),
    clients: roster.clients.length,
  }
}
