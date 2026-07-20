/**
 * P21.K.1 — Ad Strategy Engine data spine.
 *
 * Pulls per-campaign, per-day advertising metrics into `ad_daily_insights`,
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
  getCampaignDailyInsights,
  getCampaignWindowFrequency,
  MetaCampaignDailyRow,
} from '@/lib/meta/client'

/**
 * Days of history to request on a steady-state run. 7 (not 1) so that any gap
 * of up to 6 days self-heals: if a backfill fails partway through pagination,
 * getCampaignDailyInsights swallows the error and returns the rows it got, so
 * `needsBackfill` (count > 0) then sees history and never backfills again — a
 * 1-day lookback would leave that hole forever. Re-pulling the last 7 days
 * daily is cheap because the upsert is idempotent.
 */
export const DEFAULT_LOOKBACK_DAYS = 7

/**
 * Backfill depth for a client with no rows yet. 30 days gives the relative
 * baseline (best 7 days vs latest 7 days) something to stand on from day one,
 * instead of the engine sitting in `insufficient_history` for two weeks.
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

/**
 * True when this client has no `ad_daily_insights` rows yet, meaning the first
 * run should reach back further than a single day.
 */
async function needsBackfill(clientId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  // On error, assume no backfill — a failed count must not trigger a 30-day
  // pull on every run.
  if (error) return false
  return (count ?? 0) === 0
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
    const backfill = await needsBackfill(clientId)
    const lookback = backfill ? BACKFILL_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS

    // Meta reports in the ad account's timezone; "yesterday" is the last day
    // guaranteed to be complete.
    const today     = new Date()
    const until     = toIsoDate(shiftDays(today, -1))
    const since     = toIsoDate(shiftDays(today, -lookback))

    const rows = await getCampaignDailyInsights(adAccountId, accessToken, since, until)
    if (rows.length === 0) {
      return { success: true, rows_written: 0, days_requested: lookback, backfilled: backfill }
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

    const payload = rows.map(r => ({
      client_id:     clientId,
      ad_account_id: adAccountId,
      platform:      'meta',
      level:         'campaign',
      entity_id:     r.campaign_id,
      entity_name:   r.campaign_name,
      insight_date:  r.insight_date,
      spend:         r.spend,
      impressions:   r.impressions,
      reach:         r.reach,
      clicks:        r.clicks,
      frequency:     r.frequency,
      frequency_7d:  freq7dFor(r.campaign_id, r.insight_date),
      cpm:           r.cpm,
      ctr:           r.ctr,
      cpc:           r.cpc,
      leads:                   r.leads,
      messaging_conversations: r.messaging_conversations,
      results:                 r.results,
      cost_per_result:         r.cost_per_result,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabaseAdmin
      .from('ad_daily_insights')
      .upsert(payload, { onConflict: 'client_id,platform,level,entity_id,insight_date' })

    if (error) return { success: false, error: error.message }

    return {
      success: true,
      rows_written: payload.length,
      days_requested: lookback,
      backfilled: backfill,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
