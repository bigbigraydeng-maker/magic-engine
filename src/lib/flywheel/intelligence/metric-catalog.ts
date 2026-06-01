/**
 * Metric Catalog — display metadata for all tracked flywheel_metrics keys.
 *
 * Used by TrendCard, MetricSparkline, API serialisers, and InsightCard
 * rendering to turn raw metric_key strings into human-readable labels.
 *
 * Phase 22.B covers the 7 "dashboard spotlight" metrics (confirmed with PM):
 *   SEO: GSC clicks + GSC avg_position
 *   GA4: sessions + bounce_rate
 *   Ads: ROAS + spend
 *   GEO: mention_rate
 *
 * Other vocabulary keys (GSC impressions, GA4 pageviews, etc.) are included
 * for completeness so any future TrendCard render has metadata available.
 */

import type { MetricMeta } from './types'
import {
  SEO_METRIC_KEY,
  GA4_METRIC_KEY,
  ADS_METRIC_KEY,
  GEO_METRIC_KEY,
  SOCIAL_METRIC_KEY,
} from '../vocabulary'

// ─── Full catalog ─────────────────────────────────────────────────────────────

export const METRIC_CATALOG: Record<string, MetricMeta> = {

  // ── SEO — GSC-backed ────────────────────────────────────────────────────────
  [SEO_METRIC_KEY.GSC_CLICKS]: {
    label:     'GSC Clicks',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [SEO_METRIC_KEY.GSC_IMPRESSIONS]: {
    label:     'GSC Impressions',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [SEO_METRIC_KEY.GSC_AVG_POSITION]: {
    label:     'Avg Position',
    unit:      'rank',
    direction: 'lower_is_better',
  },

  // ── SEO — SEMrush-backed ────────────────────────────────────────────────────
  [SEO_METRIC_KEY.ORGANIC_KEYWORDS]: {
    label:     'Organic Keywords',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [SEO_METRIC_KEY.ORGANIC_TRAFFIC]: {
    label:     'Organic Traffic',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [SEO_METRIC_KEY.AUTHORITY_SCORE]: {
    label:     'Authority Score',
    unit:      'percent100',
    direction: 'higher_is_better',
  },
  [SEO_METRIC_KEY.PUBLISHED_POSTS]: {
    label:     'Published Posts',
    unit:      'count',
    direction: 'higher_is_better',
  },

  // ── GA4 ──────────────────────────────────────────────────────────────────────
  [GA4_METRIC_KEY.SESSIONS]: {
    label:     'Sessions',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [GA4_METRIC_KEY.USERS]: {
    label:     'Users',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [GA4_METRIC_KEY.PAGEVIEWS]: {
    label:     'Pageviews',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [GA4_METRIC_KEY.BOUNCE_RATE]: {
    label:     'Bounce Rate',
    unit:      'percent',
    direction: 'lower_is_better',
  },
  [GA4_METRIC_KEY.AVG_SESSION_DURATION]: {
    label:     'Avg Session',
    unit:      'seconds',
    direction: 'higher_is_better',
  },

  // ── Ads — Meta-backed ────────────────────────────────────────────────────────
  [ADS_METRIC_KEY.ROAS]: {
    label:     'ROAS',
    unit:      'ratio',
    direction: 'higher_is_better',
  },
  [ADS_METRIC_KEY.SPEND]: {
    label:     'Ad Spend',
    unit:      'currency',
    direction: 'lower_is_better',   // "lower is better" framing for cost metric
  },
  [ADS_METRIC_KEY.IMPRESSIONS]: {
    label:     'Ad Impressions',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [ADS_METRIC_KEY.CLICKS]: {
    label:     'Ad Clicks',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [ADS_METRIC_KEY.CPC]: {
    label:     'CPC',
    unit:      'currency',
    direction: 'lower_is_better',
  },
  [ADS_METRIC_KEY.CTR]: {
    label:     'CTR',
    unit:      'percent',
    direction: 'higher_is_better',
  },
  [ADS_METRIC_KEY.CONVERSIONS]: {
    label:     'Conversions',
    unit:      'count',
    direction: 'higher_is_better',
  },

  // ── GEO ──────────────────────────────────────────────────────────────────────
  [GEO_METRIC_KEY.QUERY_MENTION_RATE]: {
    label:     'AI Mention Rate',
    unit:      'percent',
    direction: 'higher_is_better',
  },
  [GEO_METRIC_KEY.QUERY_AVG_RANK]: {
    label:     'AI Avg Rank',
    unit:      'rank',
    direction: 'lower_is_better',
  },
  [GEO_METRIC_KEY.ENGINE_COVERAGE]: {
    label:     'Engine Coverage',
    unit:      'count',
    direction: 'higher_is_better',
  },

  // ── Social ───────────────────────────────────────────────────────────────────
  [SOCIAL_METRIC_KEY.PUBLISHED_COUNT]: {
    label:     'Published Posts',
    unit:      'count',
    direction: 'higher_is_better',
  },
  [SOCIAL_METRIC_KEY.SCHEDULED_COUNT]: {
    label:     'Scheduled Posts',
    unit:      'count',
    direction: 'higher_is_better',
  },
} as const

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Returns metadata for a given metricKey, or a safe unknown fallback. */
export function getMetricMeta(metricKey: string): MetricMeta {
  return METRIC_CATALOG[metricKey] ?? {
    label:     metricKey,
    unit:      'count',
    direction: 'higher_is_better',
  }
}

// ─── Dashboard spotlight metrics (confirmed with PM: Phase 22.B) ─────────────

/**
 * The 7 key metrics shown in IntelligenceSummarySection.
 * Order determines grid render order.
 */
export const SPOTLIGHT_METRIC_KEYS: string[] = [
  SEO_METRIC_KEY.GSC_CLICKS,
  SEO_METRIC_KEY.GSC_AVG_POSITION,
  GA4_METRIC_KEY.SESSIONS,
  GA4_METRIC_KEY.BOUNCE_RATE,
  ADS_METRIC_KEY.ROAS,
  ADS_METRIC_KEY.SPEND,
  GEO_METRIC_KEY.QUERY_MENTION_RATE,
]
