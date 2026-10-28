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
 * True when this client's hourly history exists at all.
 *
 * On query error this returns TRUE, not false. Returning false would make every
 * run request the 14-day backfill — an endless deep pull triggered by a broken
 * probe. Treating an error as "has history" keeps the steady-state window, and
 * the upsert that follows will surface a missing table loudly anyway.
 */
async function hasHourlyHistory(clientId: string, adAccountId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('ad_hourly_insights')
    .select('insight_date')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .limit(1)

  if (error) return true
  return ((data as Array<{ insight_date: string }> | null) ?? []).length > 0
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
 * Rows per upsert request. A 14-day hourly backfill is tens of thousands of
 * rows and a single statement makes the day all-or-nothing; chunking keeps one
 * bad batch from costing the whole pull.
 */
const UPSERT_CHUNK = 500

/**
 * Upsert in chunks, newest day FIRST, stopping at the first failure. Returns
 * the failure message, or null.
 *
 * The ordering is the safety property, not cosmetics. Chunking means a partial
 * write is possible, and where the resulting gap lands decides whether anyone
 * ever fills it: writing newest-first leaves the gap at the OLD edge, which is
 * exactly what the depth check looks at, so the next run re-requests it.
 * Oldest-first would leave the gap in the middle of the window, where nothing
 * looks for it.
 */
async function upsertChunked(rows: Array<Record<string, unknown>>): Promise<string | null> {
  const newestFirst = [...rows].sort((a, b) =>
    String(b.insight_date).localeCompare(String(a.insight_date)),
  )

  for (let i = 0; i < newestFirst.length; i += UPSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from('ad_hourly_insights')
      .upsert(newestFirst.slice(i, i + UPSERT_CHUNK), UPSERT_KEY)
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
    const [hasHistory, timezone] = await Promise.all([
      hasHourlyHistory(clientId, adAccountId),
      resolveAccountTimezone(adAccountId),
    ])
    const backfill = !hasHistory
    const { since, until, lookback } = hourlyRequestWindow(backfill, timezone)

    const { rows, complete } = await getAdsetHourlyInsights(adAccountId, accessToken, since, until)
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
      error: complete ? undefined : 'page walk stopped early — window is short; the next run re-requests the missing depth',
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
