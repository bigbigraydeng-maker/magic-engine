/**
 * Ad-set-level HOURLY Meta insights into `ad_hourly_insights`.
 *
 * The daily series answers "which day did this ad set fall off"; this one
 * answers "which hours of that day". Same idempotent-key discipline as
 * daily-insights.ts, one grain finer.
 *
 * Two things differ from the daily path on purpose:
 *   - The window never includes today. Today's hours are still filling in, and
 *     storing a partial day would make the newest bucket look like a collapse.
 *   - The lookback is shorter (3 days steady, 14 backfill). Hourly rows are 24x
 *     the daily row count for the same span, and the engine only needs the
 *     recent edge to explain a day it already flagged.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { accountDayKey, resolveAccountTimezone } from './account-timezone'
import {
  getAdsetHourlyInsights,
  type MetaAdsetHourlyRow,
} from '@/lib/meta/adset-hourly-insights'

/**
 * Days of history to request on a steady-state run. 3 (not 1) so a gap of up
 * to 2 days at the recent edge self-heals without waiting for the depth check.
 */
export const HOURLY_DEFAULT_LOOKBACK_DAYS = 3

/**
 * How deep the stored history should reach on a backfill. 14 days is enough to
 * explain any day the daily engine can still flag, without paying for a month
 * of 24x rows.
 */
export const HOURLY_BACKFILL_LOOKBACK_DAYS = 14

export interface SyncHourlyInsightsResult {
  success: boolean
  rows_written?: number
  days_requested?: number
  backfilled?: boolean
  error?: string
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function shiftDays(from: Date, days: number): Date {
  const out = new Date(from)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

/**
 * Does this account's stored hourly history still need a backfill?
 *
 * Judged by DEPTH, not by "any row exists": the earliest stored day must reach
 * back to the backfill window. A first run that dies half-way (Meta page walk
 * cut short, chunked write failing) leaves the newest days written and the old
 * edge missing — "any row exists" would call that complete and freeze the gap
 * forever. This mirrors daily-insights.needsBackfill.
 *
 * On query error this returns FALSE, not true. Returning true would make every
 * run request the 14-day backfill — an endless deep pull triggered by a broken
 * probe. The upsert that follows surfaces a missing table loudly anyway.
 *
 * Cost of the depth rule: an account with fewer than 14 days of delivery
 * re-pulls 14 days each run until it ages in. Cheap (one capped page walk).
 */
async function needsHourlyBackfill(
  clientId: string,
  adAccountId: string,
  backfillSince: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('ad_hourly_insights')
    .select('insight_date')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .order('insight_date', { ascending: true })
    .limit(1)

  if (error) return false
  const earliest = ((data as Array<{ insight_date: string }> | null) ?? [])[0]?.insight_date
  if (!earliest) return true
  return earliest > backfillSince
}

/**
 * The date window a run should request.
 *
 * `until` is YESTERDAY in the ad account's timezone — the last COMPLETE day.
 * Today is never requested: its hours are still filling in, and a partial day
 * would read as a collapse in the newest bucket. `since` moves on the same
 * basis so the window is not anchored half in one timezone and half in another.
 *
 * Exported for tests: the timezone arithmetic is the whole point of this
 * function and deserves to be pinned directly.
 */
export function hourlyRequestWindow(
  backfill: boolean,
  timezone: string | null,
  now: Date = new Date(),
): { since: string; until: string; lookback: number } {
  const lookback = backfill ? HOURLY_BACKFILL_LOOKBACK_DAYS : HOURLY_DEFAULT_LOOKBACK_DAYS
  // Date-only arithmetic in UTC on an already-localised day key: no DST edge,
  // because nothing here ever crosses a wall-clock hour.
  const today = new Date(`${accountDayKey(timezone, now)}T00:00:00Z`)
  return {
    since: toIsoDate(shiftDays(today, -lookback)),
    until: toIsoDate(shiftDays(today, -1)),
    lookback,
  }
}

interface HourlyRowInput {
  clientId:      string
  adAccountId:   string
  timezone:      string | null
  metrics:       MetaAdsetHourlyRow
  stampedAt:     string
}

/** Map one parsed Meta hourly row onto the `ad_hourly_insights` column set. */
function toHourlyRow(i: HourlyRowInput) {
  const m = i.metrics
  return {
    client_id:     i.clientId,
    ad_account_id: i.adAccountId,
    platform:      'meta',
    level:         'adset',
    entity_id:     m.adset_id,
    entity_name:   m.adset_name,
    parent_id:     m.campaign_id || null,
    insight_date:  m.insight_date,
    hour:          m.hour,
    account_timezone: i.timezone,
    spend:         m.spend,
    impressions:   m.impressions,
    clicks:        m.clicks,
    cpm:           m.cpm,
    ctr:           m.ctr,
    cpc:           m.cpc,
    leads:                   m.leads,
    messaging_conversations: m.messaging_conversations,
    results:                 m.results,
    cost_per_result:         m.cost_per_result,
    fetched_at: i.stampedAt,
    updated_at: i.stampedAt,
  }
}

const UPSERT_KEY = { onConflict: 'client_id,platform,level,entity_id,insight_date,hour' }

/**
 * Soft cap on rows per upsert request. A 14-day hourly backfill is tens of
 * thousands of rows and a single statement makes the whole pull all-or-nothing;
 * chunking keeps one bad batch from costing the whole pull.
 */
const UPSERT_CHUNK = 500

/**
 * Pack rows into requests WITHOUT splitting a day across two requests, newest
 * day first. A single day larger than the cap goes out as one oversized request
 * on its own — one statement is atomic, so a day is either fully stored or not
 * stored at all.
 *
 * Why this matters (Codex review on PR 3352): the depth check trusts the
 * earliest stored day. If the OLDEST day could be half-written (some of its rows
 * in a request that succeeded, the rest in one that failed), the earliest day
 * would exist, the backfill would be judged complete, and the missing rows would
 * never be requested again.
 */
function packByDay(rows: Array<Record<string, unknown>>): Array<Array<Record<string, unknown>>> {
  const byDay = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const day = String(row.insight_date)
    const bucket = byDay.get(day)
    if (bucket) bucket.push(row)
    else byDay.set(day, [row])
  }
  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a))

  const chunks: Array<Array<Record<string, unknown>>> = []
  let current: Array<Record<string, unknown>> = []
  for (const day of days) {
    const dayRows = byDay.get(day) ?? []
    if (current.length > 0 && current.length + dayRows.length > UPSERT_CHUNK) {
      chunks.push(current)
      current = []
    }
    current = current.concat(dayRows)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * Upsert day-packed requests, newest day FIRST, stopping at the first failure.
 * Returns the failure message, or null.
 *
 * The ordering is the safety property, not cosmetics. A partial write is
 * possible, and where the resulting gap lands decides whether anyone ever fills
 * it: writing newest-first leaves the gap at the OLD edge, which is exactly what
 * the depth check looks at, so the next run re-requests it. Oldest-first would
 * leave the gap in the middle of the window, where nothing looks for it.
 */
async function upsertChunked(rows: Array<Record<string, unknown>>): Promise<string | null> {
  for (const chunk of packByDay(rows)) {
    const { error } = await supabaseAdmin.from('ad_hourly_insights').upsert(chunk, UPSERT_KEY)
    if (error) return error.message
  }
  return null
}

/**
 * Pull and store one client's ad-set hourly series.
 *
 * Degrades rather than throws, matching the cron's per-client isolation
 * convention: one client's expired token must not take the whole run down.
 */
export async function syncAdsetHourlyInsights(
  clientId: string,
  adAccountId: string,
  accessToken: string,
): Promise<SyncHourlyInsightsResult> {
  try {
    const timezone = await resolveAccountTimezone(adAccountId)
    let backfill = await needsHourlyBackfill(
      clientId,
      adAccountId,
      hourlyRequestWindow(true, timezone).since,
    )
    let { since, until, lookback } = hourlyRequestWindow(backfill, timezone)

    let { rows, complete } = await getAdsetHourlyInsights(adAccountId, accessToken, since, until)
    // A backfill that returned NOTHING and did not finish (Meta refused the deep
    // pull) must not also cost the steady-state days: retry once with the short
    // window so the recent edge still lands while the deep pull keeps failing.
    if (backfill && rows.length === 0 && !complete) {
      backfill = false
      ;({ since, until, lookback } = hourlyRequestWindow(false, timezone))
      ;({ rows, complete } = await getAdsetHourlyInsights(adAccountId, accessToken, since, until))
    }
    if (rows.length === 0) {
      // An empty result only means "no delivery" when the walk actually
      // finished; otherwise Meta failed and silence would look identical.
      return complete
        ? { success: true, rows_written: 0, days_requested: lookback, backfilled: backfill }
        : { success: false, rows_written: 0, days_requested: lookback, backfilled: backfill,
            error: 'Meta returned no usable page — check the token and rate limit' }
    }

    const stampedAt = new Date().toISOString()
    const payload = rows.map(r => toHourlyRow({
      clientId,
      adAccountId,
      timezone,
      metrics:   r,
      stampedAt,
    }))

    const failure = await upsertChunked(payload)
    if (failure) return { success: false, error: failure }

    return {
      success: complete,
      rows_written: payload.length,
      days_requested: lookback,
      backfilled: backfill,
      // Steady-state runs re-pull the same window daily, so a short window is
      // self-healing — but it should still be visible rather than silent.
      error: complete ? undefined : 'page walk stopped early — window is short; the next run re-requests the missing depth (depth check)',
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
