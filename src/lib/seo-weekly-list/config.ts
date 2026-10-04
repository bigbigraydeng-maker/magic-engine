/**
 * Thresholds for the SEO weekly list (docs/specs/2026-10-04-seo-weekly-list-v0.2.md).
 *
 * Defaults live here; a client may override any of them under
 * `clients.seo_config.loop.*` (absent key = default). Nothing here is client- or
 * industry-specific — a local long-tail industry simply overrides the volume gates.
 */

/** Goal metric whose active goal switches the weekly list on for a client. */
export const SEO_LOOP_METRIC_KEY = 'seo_gsc_clicks_28d'

export interface SeoLoopConfig {
  /** Max new list items per weekly run. */
  weeklyMaxItems: number
  /** No new items while this many plan items are still open. */
  wipCap: number
  nearMissMinVolume: number
  nearMissMinRank: number
  nearMissMaxRank: number
  /** Page-level low-CTR gate: minimum 28-day impressions. */
  ctrGapMinImpressions: number
  /** Page-level low-CTR gate: only pages averaging at or above this position. */
  ctrGapMaxPosition: number
  /** CTR must be below benchmark × this ratio. */
  ctrGapRatio: number
  /** An open item untouched this long is skipped with reason expired_no_action. */
  expiryDays: number
  /** A target decided (completed / skipped) within this window is not re-listed. */
  cooldownDays: number
  /** strengthen_page verifies when the page gained at least this many words since the item was created. */
  strengthenMinWordGain: number
  /** Keyword snapshot older than this many days → no new items (stale ranks must not read as current). */
  snapshotMaxAgeDays: number
  /** A page's crawl must be at most this old to take a word-count baseline from it. */
  baselineMaxCrawlAgeDays: number
  /** Traffic decay: the page needs at least this many clicks in the PREVIOUS 28 days to count. */
  decayMinPriorClicks: number
  /** Traffic decay: clicks must have fallen by at least this share (0.4 = 40%). */
  decayMinDropRatio: number
  /** Traffic decay: ... and by at least this many clicks (noise guard for small pages). */
  decayMinAbsDrop: number
  /** Traffic decay: the click loss must exceed this many "standard deviations" of ordinary random variation (sqrt of the previous clicks), so a 13 → 7 wobble on a small page is not a decline. */
  decaySigma: number
  /** Traffic decay: page ratio / site ratio must be at or below this (page falls clearly more than the site). */
  decayVsSiteRatio: number
  /** Traffic decay: the previous 28-day window must have data on at least this many days, else no decay items. */
  decayMinPriorDays: number
}

export const DEFAULT_SEO_LOOP_CONFIG: SeoLoopConfig = {
  weeklyMaxItems: 5,
  wipCap: 8,
  nearMissMinVolume: 100,
  nearMissMinRank: 4,
  nearMissMaxRank: 30,
  ctrGapMinImpressions: 300,
  ctrGapMaxPosition: 10,
  ctrGapRatio: 0.6,
  expiryDays: 14,
  cooldownDays: 90,
  strengthenMinWordGain: 100,
  snapshotMaxAgeDays: 14,
  baselineMaxCrawlAgeDays: 8,
  decayMinPriorClicks: 8,
  decayMinDropRatio: 0.4,
  decayMinAbsDrop: 5,
  decaySigma: 2,
  decayVsSiteRatio: 0.6,
  decayMinPriorDays: 26,
}

/** Read `seo_config.loop` overrides; anything that is not a finite positive number is ignored. */
export function resolveSeoLoopConfig(seoConfig: unknown): SeoLoopConfig {
  const out: SeoLoopConfig = { ...DEFAULT_SEO_LOOP_CONFIG }
  if (!seoConfig || typeof seoConfig !== 'object') return out
  const loop = (seoConfig as Record<string, unknown>).loop
  if (!loop || typeof loop !== 'object') return out
  for (const key of Object.keys(out) as Array<keyof SeoLoopConfig>) {
    const v = (loop as Record<string, unknown>)[key]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = v
  }
  return out
}
