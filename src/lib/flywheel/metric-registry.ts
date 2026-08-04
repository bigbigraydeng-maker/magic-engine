/**
 * Metric registry — the single truth source for "is anybody actually pulling
 * this metric?".
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * The ads flywheel logged 24 actions and produced 0 outcomes for months, and
 * nothing anywhere reported an error. The break needed three parts, each of
 * which looked fine on its own:
 *
 *   1. `ADS_METRIC_KEY` declared `ads.account.roas`.
 *   2. Action writers declared `expected_metric: 'ads.account.roas'`.
 *   3. No puller ever produced a `ads.account.roas` row for those clients
 *      (a Messenger-objective campaign has no purchases, so Meta reports no
 *      purchase_roas at all).
 *
 * `runAttributionJob` needs a metric row before AND after the action. With no
 * rows at all it finds no baseline and `return false`s — counted as "skipped",
 * never logged, never alerted. Three months later the flywheel is empty.
 *
 * So a metric key being in the vocabulary is NOT enough to promise it on an
 * action. This registry records, per key, which pullers write it — and the gate
 * below refuses an `expected_metric` that nobody pulls, at write time, loudly.
 *
 * ── How it stays honest ──────────────────────────────────────────────────────
 * `ADS_METRIC_PULLERS` is typed `Record<AdsMetricKey, …>`, so adding a key to
 * `ADS_METRIC_KEY` without deciding who pulls it fails to compile. Pullers then
 * derive their own key lists from this map (see the daily cron), so the
 * registry and the pull are the same fact rather than two copies of it.
 *
 * An empty array is a legal, deliberate entry: "declared, nothing pulls it
 * yet". It just cannot be promised as an action's expected_metric.
 */

import { ADS_METRIC_KEY, type AdsMetricKey } from './vocabulary'

/** A named job that writes rows into flywheel_metrics. */
export type MetricPuller =
  /** MetaAdsAdapter.pullMetrics() — reads the latest meta_ads_snapshots row. */
  | 'meta_ads'
  /** google-data-pullback-daily syncMeta() — objective-aware Meta costs. */
  | 'meta_ads_pullback'
  /** google-data-pullback-daily syncGoogleAds() — Google Ads account insights. */
  | 'google_ads_pullback'
  /** google-data-pullback-daily syncGa4() — GA4 Paid Search channel group. */
  | 'ga4_paid_search_pullback'

/**
 * Ads metric key → the pullers that write it. Exhaustive by construction.
 *
 * Keep the `source` string each puller stamps on its flywheel_metrics rows
 * identical to the puller name here — that is what makes a row traceable back
 * to the entry that authorised it.
 */
export const ADS_METRIC_PULLERS: Readonly<Record<AdsMetricKey, readonly MetricPuller[]>> = {
  // ── Delivery metrics: both ad platforms report these unconditionally ──────
  [ADS_METRIC_KEY.SPEND]:       ['meta_ads', 'google_ads_pullback'],
  [ADS_METRIC_KEY.IMPRESSIONS]: ['meta_ads', 'google_ads_pullback'],
  [ADS_METRIC_KEY.CLICKS]:      ['meta_ads', 'google_ads_pullback'],
  [ADS_METRIC_KEY.CPC]:         ['meta_ads', 'google_ads_pullback'],
  [ADS_METRIC_KEY.CTR]:         ['meta_ads', 'google_ads_pullback'],

  // ── Outcome metrics: only ever written when the objective produces them ──
  // Registered = a puller will write a row WHEN the data exists. It does not
  // promise every client has one; a Messenger account will never grow a ROAS
  // row, which is exactly why resolveAdsExpectedMetric must not pick ROAS
  // for it.
  [ADS_METRIC_KEY.ROAS]:                  ['meta_ads'],
  [ADS_METRIC_KEY.CONVERSIONS]:           ['meta_ads', 'google_ads_pullback'],
  [ADS_METRIC_KEY.CPA]:                   ['meta_ads_pullback', 'google_ads_pullback'],
  [ADS_METRIC_KEY.COST_PER_LEAD]:         ['meta_ads_pullback'],
  [ADS_METRIC_KEY.COST_PER_CONVERSATION]: ['meta_ads_pullback'],

  // ── GA4 paid-search cross-check ──────────────────────────────────────────
  [ADS_METRIC_KEY.GA4_PAID_SESSIONS]:    ['ga4_paid_search_pullback'],
  [ADS_METRIC_KEY.GA4_PAID_USERS]:       ['ga4_paid_search_pullback'],
  [ADS_METRIC_KEY.GA4_PAID_CONVERSIONS]: ['ga4_paid_search_pullback'],
}

const ADS_METRIC_KEYS = new Set<string>(Object.values(ADS_METRIC_KEY))

/** True when `key` is an ads metric key AND at least one puller writes it. */
export function isAdsMetricPulled(key: string): key is AdsMetricKey {
  if (!ADS_METRIC_KEYS.has(key)) return false
  return ADS_METRIC_PULLERS[key as AdsMetricKey].length > 0
}

/**
 * The ads metric keys a given puller is responsible for.
 *
 * Pullers call this instead of hand-listing keys, so "the registry says X pulls
 * this" and "X actually pulls this" cannot drift apart.
 */
export function adsMetricKeysWrittenBy(puller: MetricPuller): AdsMetricKey[] {
  return (Object.keys(ADS_METRIC_PULLERS) as AdsMetricKey[])
    .filter(key => ADS_METRIC_PULLERS[key].includes(puller))
}

/** Thrown when an action would promise a metric nothing measures. */
export class UnpullableMetricError extends Error {
  constructor(readonly metricKey: string, readonly context: string) {
    super(
      `[${context}] refusing to write flywheel_action with expected_metric ` +
        `"${metricKey}": ${explainAdsMetricGap(metricKey)}. An action whose ` +
        `metric nobody pulls produces no outcome and fails silently — pick a ` +
        `metric from ADS_METRIC_PULLERS, or register a puller for this one.`,
    )
    this.name = 'UnpullableMetricError'
  }
}

function explainAdsMetricGap(key: string): string {
  if (!ADS_METRIC_KEYS.has(key)) {
    return 'not a key in ADS_METRIC_KEY (vocabulary.ts) at all'
  }
  return 'declared in ADS_METRIC_KEY but no puller writes it (see ADS_METRIC_PULLERS)'
}

/**
 * The reconciliation gate. Call before writing an ads flywheel_action.
 *
 * Throws rather than returning a boolean on purpose: a caller that forgets to
 * check a boolean reproduces the exact failure this file exists to stop.
 * `null`/`undefined` passes — an action with no expected_metric is honest about
 * not being measured, which is different from claiming a metric that is never
 * collected.
 */
export function assertAdsExpectedMetric(
  metricKey: string | null | undefined,
  context: string,
): void {
  if (metricKey === null || metricKey === undefined) return
  if (isAdsMetricPulled(metricKey)) return
  throw new UnpullableMetricError(metricKey, context)
}
