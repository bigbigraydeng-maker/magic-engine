/**
 * Metric polarity — single source of truth for metric direction.
 *
 * Used by attribution verdicts and the health score to decide whether a
 * rising value is good or bad. Any metric key not listed here defaults to
 * "higher is better".
 */

import { ADS_METRIC_KEY, GEO_METRIC_KEY, SEO_METRIC_KEY } from './vocabulary'

export type MetricPolarity = 'lower_is_better' | 'higher_is_better' | 'neutral'

export const METRIC_POLARITY: Readonly<Record<string, MetricPolarity>> = {
  // ── lower is better ────────────────────────────────────────────────────────
  [ADS_METRIC_KEY.COST_PER_LEAD]: 'lower_is_better',
  [ADS_METRIC_KEY.COST_PER_CONVERSATION]: 'lower_is_better',
  [ADS_METRIC_KEY.CPA]: 'lower_is_better',
  [ADS_METRIC_KEY.CPC]: 'lower_is_better',
  [GEO_METRIC_KEY.QUERY_AVG_RANK]: 'lower_is_better',
  [SEO_METRIC_KEY.GSC_AVG_POSITION]: 'lower_is_better',
  [SEO_METRIC_KEY.GSC_PAGE_AVG_POSITION]: 'lower_is_better',
  [SEO_METRIC_KEY.GA4_BOUNCE_RATE]: 'lower_is_better',

  // ── neutral ────────────────────────────────────────────────────────────────
  // Spending more is not good or bad by itself.
  [ADS_METRIC_KEY.SPEND]: 'neutral',
}

export function getMetricPolarity(metricKey: string): MetricPolarity {
  return METRIC_POLARITY[metricKey] ?? 'higher_is_better'
}

export function isLowerBetter(metricKey: string): boolean {
  return getMetricPolarity(metricKey) === 'lower_is_better'
}
