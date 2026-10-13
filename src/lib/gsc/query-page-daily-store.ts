/**
 * Database side of the per-(query, page) daily GSC store (`gsc_query_page_daily`). It plugs into the shared
 * pull code as a `PullDataset` (page-daily-pull.ts) and the shared planner (page-daily-store.ts) with its own
 * receipts table, so the per-page chain is never touched.
 *
 * Rules enforced here:
 * - Rows are upserted by (client_id, day, query, page_url) exactly as Google returned them — nothing is
 *   case-folded on write, because folding two keys into one would make one row overwrite the other's clicks.
 * - Rows whose query + URL, or page_key, are longer than MAX_URL_BYTES bytes are not written (btree index entry
 *   limit) and are counted instead (reported through the receipt's `skipped_long_urls` column).
 * - Every write result is checked: a failed write throws and is never counted as written.
 *
 * No client names or ids live here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { startCronRunWithId } from '@/lib/cron/run-logger'
import { gscPageKey } from '@/lib/url/page-key'
import type { GscAnalyticsRow } from './client'
import { PAGE_DATASET, type PullDataset } from './page-daily-pull'
import { MAX_URL_BYTES, UPSERT_BATCH_SIZE, utf8Bytes } from './page-daily-store'

export const QUERY_PAGE_DAILY_TABLE = 'gsc_query_page_daily'
export const QUERY_PAGE_RECEIPTS_TABLE = 'gsc_query_page_fetch_receipts'
/** cron_run_logs.job_name for the dispatch row (must equal its CRON_REGISTRY jobName). */
export const GSC_QUERY_PAGE_DAILY_JOB = 'gsc-query-page-daily'
/** Cloud-only event; the per-page chain listens to a DIFFERENT event name, so neither can run the other's orders. */
export const GSC_QUERY_PAGE_DAILY_PULL_EVENT = 'gsc/query-page-daily.pull.due'
/**
 * The ONLY definition of this chain's schedule (Inngest cron trigger and CRON_REGISTRY both read it).
 * 19:00 UTC daily — 30 minutes after the per-page chain (18:30) so the two do not start together.
 */
export const GSC_QUERY_PAGE_DAILY_CRON = '0 19 * * *'
/** cron_run_logs.job_name for each pull order of this chain (must equal its CRON_REGISTRY jobName). */
export const GSC_QUERY_PAGE_DAILY_PULL_JOB = 'gsc-query-page-daily-pull'
/** Backfill months per client per dispatch: 16 months fill in about 4 days, not all at once. */
export const QUERY_PAGE_BACKFILL_SEGMENTS_PER_DISPATCH = 4

export interface QueryPageDailyRow {
  readonly client_id: string
  readonly day: string
  readonly query: string
  readonly page_url: string
  readonly page_key: string
  readonly clicks: number
  readonly impressions: number
  readonly position: number
}

/**
 * Turn one day's rows (keys = [query, page]) into storable rows, deduping by (query, page_url). Same pair twice
 * in one batch would make Postgres reject the whole upsert, so the later row replaces the earlier.
 */
export function toQueryPageDailyRows(
  clientId: string,
  day: string,
  rows: readonly GscAnalyticsRow[],
): { rows: QueryPageDailyRow[]; skippedLongUrls: number } {
  const byPair = new Map<string, QueryPageDailyRow>()
  let skippedLongUrls = 0

  for (const r of rows) {
    const query = r.keys[0]
    const pageUrl = r.keys[1]
    if (typeof query !== 'string' || query.length === 0) continue
    if (typeof pageUrl !== 'string' || pageUrl.length === 0) continue
    const pageKey = gscPageKey(pageUrl) ?? pageUrl
    if (utf8Bytes(query) + utf8Bytes(pageUrl) > MAX_URL_BYTES || utf8Bytes(pageKey) > MAX_URL_BYTES) {
      skippedLongUrls += 1
      continue
    }
    byPair.set(`${query}\u0000${pageUrl}`, {
      client_id: clientId,
      day,
      query,
      page_url: pageUrl,
      page_key: pageKey,
      clicks: Math.round(r.clicks),
      impressions: Math.round(r.impressions),
      position: r.position,
    })
  }

  return { rows: [...byPair.values()], skippedLongUrls }
}

/** Upsert one day's rows in batches; a failed batch throws and is never counted. */
export async function upsertQueryPageDayRows(
  supabase: SupabaseClient,
  clientId: string,
  day: string,
  rows: readonly GscAnalyticsRow[],
): Promise<{ written: number; skippedLongUrls: number }> {
  const { rows: out, skippedLongUrls } = toQueryPageDailyRows(clientId, day, rows)

  for (let i = 0; i < out.length; i += UPSERT_BATCH_SIZE) {
    const chunk = out.slice(i, i + UPSERT_BATCH_SIZE)
    const { error } = await supabase
      .from(QUERY_PAGE_DAILY_TABLE)
      .upsert(chunk, { onConflict: 'client_id,day,query,page_url' })
    if (error) {
      throw new Error(`[db] ${QUERY_PAGE_DAILY_TABLE} upsert failed for ${day}: ${error.message}`)
    }
  }

  return { written: out.length, skippedLongUrls }
}

/** The (query, page) data set for the shared pull code. */
export const QUERY_PAGE_DATASET: PullDataset = {
  ...PAGE_DATASET,
  dimensions: ['query', 'page'],
  pullJob: GSC_QUERY_PAGE_DAILY_PULL_JOB,
  startRun: (runLogId) => startCronRunWithId(GSC_QUERY_PAGE_DAILY_PULL_JOB, runLogId),
  receiptsTable: QUERY_PAGE_RECEIPTS_TABLE,
  upsertDay: upsertQueryPageDayRows,
}
