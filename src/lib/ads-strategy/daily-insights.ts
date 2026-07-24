/**
 * P21.K.1 / P21.K.7 — Ad Strategy Engine data spine.
 *
 * Pulls per-campaign and per-ad, per-day advertising metrics into `ad_daily_insights`,
 * the time series the engine needs to judge fatigue against a campaign's own
 * historical baseline (spec §12) rather than against fixed absolute thresholds
 * — thresholds that a real fatigue event proved blind to: Reborn's CTR fell 41%
 * (4.22% → 2.50%) while frequency never left 1.1, so neither the "frequency
 * > 2.5" nor the "CTR < 2%" line ever fired.
 *
 * This runs INSIDE the existing google-data-pullback-daily cron rather than as
 * a new schedule: that cron already pulls Meta every day, and a second one
 * would double-write and burn API quota for nothing.
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  getAdDailyInsights,
  getCampaignDailyInsights,
  getCampaignWindowFrequency,
  MetaCampaignDailyRow,
} from '@/lib/meta/client'

/**
 * Days of history to request on a steady-state run. 7 (not 1) so that a gap of
 * up to 6 days at the recent edge self-heals without waiting for the depth
 * check: Meta also restates the last few days as attribution lands. Re-pulling
 * the last 7 days daily is cheap because the upsert is idempotent.
 */
export const DEFAULT_LOOKBACK_DAYS = 7

/**
 * How deep the stored history should reach. 30 days gives the relative baseline
 * (best 7 days vs latest 7 days) something to stand on from day one, instead of
 * the engine sitting in `insufficient_history` for two weeks. Doubles as the
 * depth `needsBackfill` measures against.
 */
export const BACKFILL_LOOKBACK_DAYS = 30

export interface SyncDailyInsightsResult {
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

type InsightLevel = 'campaign' | 'ad'

/**
 * True when this client's stored history AT THIS LEVEL does not reach back far
 * enough, so the run should request the deep window instead of the recent one.
 *
 * This asks "how deep is the history" rather than "are there any rows at all",
 * and that difference is what makes every partial write self-healing. A
 * row-count probe treats one surviving row as proof the backfill finished, so a
 * page walk cut short by rate limiting — or a chunked write that died halfway —
 * silently freezes the missing days out forever. Depth is re-checked daily, so
 * the next run simply asks for them again.
 *
 * The level filter is load-bearing, not cosmetic: campaign rows land first, so
 * an unfiltered probe would see them, conclude the ad level has history too and
 * skip its backfill entirely.
 *
 * Cost of being self-healing: an account whose ads are younger than the backfill
 * window can never satisfy the depth test (no data exists before its first day),
 * so it re-requests the deep window daily. That is one extra page walk and an
 * idempotent re-upsert — cheap next to a silent hole nobody can see.
 */
async function needsBackfill(clientId: string, level: InsightLevel): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('insight_date')
    .eq('client_id', clientId)
    .eq('level', level)
    .order('insight_date', { ascending: true })
    .limit(1)

  // On error, assume no backfill — a failed probe must not trigger a deep
  // pull on every run.
  if (error) return false

  const earliest = (data as Array<{ insight_date: string }> | null)?.[0]?.insight_date
  if (!earliest) return true
  return earliest > toIsoDate(shiftDays(new Date(), -BACKFILL_LOOKBACK_DAYS))
}

/** The date window a run should request, given whether it is backfilling. */
function requestWindow(backfill: boolean): { since: string; until: string; lookback: number } {
  const lookback = backfill ? BACKFILL_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS
  // Meta reports in the ad account's timezone; "yesterday" is the last day
  // guaranteed to be complete.
  const today = new Date()
  return {
    since: toIsoDate(shiftDays(today, -lookback)),
    until: toIsoDate(shiftDays(today, -1)),
    lookback,
  }
}

interface InsightRowInput {
  clientId:     string
  adAccountId:  string
  level:        InsightLevel
  entityId:     string
  entityName:   string
  frequency7d:  number | null
  metrics:      MetaCampaignDailyRow
  stampedAt:    string
}

/** Map one parsed Meta row onto the `ad_daily_insights` column set. */
function toInsightRow(i: InsightRowInput) {
  const m = i.metrics
  return {
    client_id:     i.clientId,
    ad_account_id: i.adAccountId,
    platform:      'meta',
    level:         i.level,
    entity_id:     i.entityId,
    entity_name:   i.entityName,
    insight_date:  m.insight_date,
    spend:         m.spend,
    impressions:   m.impressions,
    reach:         m.reach,
    clicks:        m.clicks,
    frequency:     m.frequency,
    frequency_7d:  i.frequency7d,
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

const UPSERT_KEY = { onConflict: 'client_id,platform,level,entity_id,insight_date' }

/**
 * Rows per upsert request. A 30-day ad-level backfill is thousands of rows and
 * a single statement makes the day all-or-nothing; chunking keeps one bad batch
 * from costing the whole pull.
 */
const UPSERT_CHUNK = 500

/**
 * Upsert in chunks, oldest day LAST, stopping at the first failure. Returns the
 * failure message, or null.
 *
 * The ordering is the safety property, not cosmetics. Chunking means a partial
 * write is possible, and where the resulting gap lands decides whether anyone
 * ever fills it: writing newest-first leaves the gap at the OLD edge, which is
 * exactly what `needsBackfill`'s depth test looks at, so the next run re-requests
 * it. Oldest-first would leave the gap in the middle of the window, where
 * nothing looks for it.
 */
async function upsertChunked(rows: Array<Record<string, unknown>>): Promise<string | null> {
  const newestFirst = [...rows].sort((a, b) =>
    String(b.insight_date).localeCompare(String(a.insight_date)),
  )

  for (let i = 0; i < newestFirst.length; i += UPSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from('ad_daily_insights')
      .upsert(newestFirst.slice(i, i + UPSERT_CHUNK), UPSERT_KEY)
    if (error) return error.message
  }
  return null
}

/**
 * The trailing 7-day window frequency belongs to ONE row per campaign: the
 * latest day. Frequency is impressions/reach and is not additive — averaging
 * seven daily frequencies is not the 7-day frequency, because reach
 * deduplicates people across the window. Storing it on every day of the
 * campaign would double-count it, so this returns a lookup keyed by
 * campaign_id + date that only ever matches the latest day.
 */
function windowFrequencyByRow(
  latestDate: string,
  freqByCampaign: Map<string, number>,
): (campaignId: string, insightDate: string) => number | null {
  return (campaignId, insightDate) => {
    if (insightDate !== latestDate) return null
    return freqByCampaign.get(campaignId) ?? null
  }
}

/**
 * Pull and store one client's campaign-level daily series.
 *
 * Degrades rather than throws, matching the cron's per-client isolation
 * convention: one client's expired token must not take the whole run down.
 */
export async function syncCampaignDailyInsights(
  clientId: string,
  adAccountId: string,
  accessToken: string,
): Promise<SyncDailyInsightsResult> {
  try {
    const backfill = await needsBackfill(clientId, 'campaign')
    const { since, until, lookback } = requestWindow(backfill)

    const { rows, complete } = await getCampaignDailyInsights(adAccountId, accessToken, since, until)
    if (rows.length === 0) {
      // An empty result only means "no delivery" when the walk actually
      // finished; otherwise Meta failed and silence would look identical.
      return complete
        ? { success: true, rows_written: 0, days_requested: lookback, backfilled: backfill }
        : { success: false, rows_written: 0, days_requested: lookback, backfilled: backfill,
            error: 'Meta returned no usable page — check the token and rate limit' }
    }

    const latestDate = rows.reduce(
      (max, r) => (r.insight_date > max ? r.insight_date : max),
      rows[0].insight_date,
    )

    // Trailing 7 days ending on the newest day we just stored.
    const freqSince = toIsoDate(shiftDays(new Date(`${latestDate}T00:00:00Z`), -6))
    const windowFreq = await getCampaignWindowFrequency(
      adAccountId,
      accessToken,
      freqSince,
      latestDate,
    )
    const freq7dFor = windowFrequencyByRow(latestDate, windowFreq)

    const stampedAt = new Date().toISOString()
    const payload = rows.map(r => toInsightRow({
      clientId,
      adAccountId,
      level:       'campaign',
      entityId:    r.campaign_id,
      entityName:  r.campaign_name,
      frequency7d: freq7dFor(r.campaign_id, r.insight_date),
      metrics:     r,
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

/**
 * Pull and store one client's AD-level daily series (P21.K.7).
 *
 * Same table, same idempotent key, one level down — `level='ad'` was reserved
 * in the P21.K.1 schema for exactly this, so nothing about the campaign series
 * changes and every existing reader already filters `level='campaign'`.
 *
 * Two deliberate differences from the campaign path:
 *   - `parent_id` carries the ad's campaign, so "which ad dragged THIS campaign
 *     down" is a query rather than a trip to Ads Manager.
 *   - No 7-day window frequency. It would double the Graph calls for a number
 *     the fatigue engine only reads at campaign level, and Meta's BUC quota is
 *     charged per call. The dense daily `frequency` column is still populated.
 */
export async function syncAdDailyInsights(
  clientId: string,
  adAccountId: string,
  accessToken: string,
): Promise<SyncDailyInsightsResult> {
  try {
    const backfill = await needsBackfill(clientId, 'ad')
    const { since, until, lookback } = requestWindow(backfill)

    const { rows, complete } = await getAdDailyInsights(adAccountId, accessToken, since, until)
    if (rows.length === 0) {
      return complete
        ? { success: true, rows_written: 0, days_requested: lookback, backfilled: backfill }
        : { success: false, rows_written: 0, days_requested: lookback, backfilled: backfill,
            error: 'Meta returned no usable page — check the token and rate limit' }
    }

    const stampedAt = new Date().toISOString()
    const payload = rows.map(r => ({
      ...toInsightRow({
        clientId,
        adAccountId,
        level:       'ad',
        entityId:    r.ad_id,
        entityName:  r.ad_name,
        frequency7d: null,
        metrics:     r,
        stampedAt,
      }),
      parent_id: r.campaign_id || null,
    }))

    const failure = await upsertChunked(payload)
    if (failure) return { success: false, error: failure }

    return {
      success: complete,
      rows_written: payload.length,
      days_requested: lookback,
      backfilled: backfill,
      error: complete ? undefined : 'page walk stopped early — window is short; the next run re-requests the missing depth',
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
