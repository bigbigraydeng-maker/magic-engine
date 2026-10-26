/**
 * Magic Engine 2.0 · Inngest consumers for the per-(query, page) daily Google Search Console store
 * (`gsc_query_page_daily` / `gsc_query_page_fetch_receipts`).
 *
 * This is the SAME dispatch + pull code as the per-page store (gsc-page-daily.ts), run with a different
 * `GscChainVariant`: its own event name, event-id prefix, job names, Inngest function ids, schedule and receipts
 * table. Nothing is shared at run time except the code, so a failure or an unsynced deploy of one chain cannot
 * affect the other. Why Inngest rather than a Render cron: see the header of gsc-page-daily.ts — the same two
 * trade-offs apply (re-Sync `/api/inngest` after deploy; CRON_REGISTRY's receipts-table freshness check reports
 * "never ran" if that step is forgotten).
 *
 * Read-only towards Google, never publishes anything (`no_publish: true`).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { CLOUD_FN_PREFIX } from '../client'
import { startCronRunWithId } from '@/lib/cron/run-logger'
import { buildPageDailyPlan } from '@/lib/gsc/page-daily-store'
import {
  GSC_QUERY_PAGE_DAILY_CRON,
  GSC_QUERY_PAGE_DAILY_JOB,
  GSC_QUERY_PAGE_DAILY_PULL_EVENT,
  QUERY_PAGE_BACKFILL_SEGMENTS_PER_DISPATCH,
  QUERY_PAGE_DATASET,
  QUERY_PAGE_RECEIPTS_TABLE,
} from '@/lib/gsc/query-page-daily-store'
import type { PullDeps } from '@/lib/gsc/page-daily-pull'
import {
  createGscPageDailyFanOutFunction,
  createGscPageDailyPullFunction,
  defaultPullDeps,
  type FanOutDeps,
  type GscChainVariant,
} from './gsc-page-daily'

export const GSC_QUERY_PAGE_DAILY_FANOUT_ID = `${CLOUD_FN_PREFIX}gsc-query-page-daily-fanout`
export const GSC_QUERY_PAGE_DAILY_PULL_ID = `${CLOUD_FN_PREFIX}gsc-query-page-daily-pull`

export const QUERY_PAGE_CHAIN: GscChainVariant = {
  job: GSC_QUERY_PAGE_DAILY_JOB,
  startRun: (runLogId) => startCronRunWithId(GSC_QUERY_PAGE_DAILY_JOB, runLogId),
  eventName: GSC_QUERY_PAGE_DAILY_PULL_EVENT,
  eventIdPrefix: 'gsc-query-page-daily',
  fanoutId: GSC_QUERY_PAGE_DAILY_FANOUT_ID,
  fanoutName: 'GSC per-(query, page) daily: dispatch pull orders',
  pullId: GSC_QUERY_PAGE_DAILY_PULL_ID,
  pullName: 'GSC per-(query, page) daily: pull one order',
  cron: GSC_QUERY_PAGE_DAILY_CRON,
  dataset: QUERY_PAGE_DATASET,
}

/** The dispatch's plan builder: the query-page receipts table and 4 backfill months per client per dispatch. */
export function queryPageFanOutDeps(supabase: SupabaseClient = supabaseAdmin): FanOutDeps {
  return {
    buildPlan: (today) =>
      buildPageDailyPlan(supabase, today, {
        receiptsTable: QUERY_PAGE_RECEIPTS_TABLE,
        maxBackfillSegments: QUERY_PAGE_BACKFILL_SEGMENTS_PER_DISPATCH,
      }),
  }
}

/** The pull worker's dependencies: the shared ones plus this chain's data set. */
export const QUERY_PAGE_PULL_DEPS: PullDeps = { ...defaultPullDeps(), dataset: QUERY_PAGE_DATASET }

/** Production instances. */
export const gscQueryPageDailyFanOut = createGscPageDailyFanOutFunction(queryPageFanOutDeps(), QUERY_PAGE_CHAIN)

export const gscQueryPageDailyPull = createGscPageDailyPullFunction(QUERY_PAGE_PULL_DEPS, QUERY_PAGE_CHAIN)
