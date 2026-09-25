/**
 * Meta Graph API client — barrel re-export.
 *
 * The implementation was split into focused modules (each well under the
 * 800-line limit) so the read paths, write paths, and shared transport are
 * separable:
 *
 *   graph-base.ts          — GRAPH_BASE (v21.0) + pagination machinery
 *   account-insights.ts    — account-level insights + shared row parser
 *   campaign-insights.ts   — campaign aggregate / daily / window frequency
 *   adset-insights.ts      — ad-set daily time series
 *   ad-insights.ts         — ad daily time series
 *   campaign-management.ts — read "before" state, set status / budget
 *   boost.ts               — boost an existing Page post
 *
 * P12.B.2: Used by the /api/clients/[id]/meta-ads/sync route to pull
 * account-level insights and write them to meta_ads_snapshots.
 *
 * Requires META_SYSTEM_USER_TOKEN in env (long-lived system user token).
 * Returns null gracefully when the token is not configured.
 */

export { GRAPH_BASE, MAX_INSIGHT_PAGES, fetchInsightPages } from './graph-base'
export type { InsightPageWalk } from './graph-base'

export { getAdAccountInsights, parseInsights } from './account-insights'
export type { MetaAdsInsights, GraphInsightsData } from './account-insights'

export {
  getAdCampaignInsights,
  getCampaignDailyInsights,
  getCampaignWindowFrequency,
  parseDailyMetrics,
  DAILY_FIELD_LIST,
} from './campaign-insights'
export type {
  MetaCampaignInsight,
  MetaCampaignDailyRow,
  GraphCampaignRow,
  GraphCampaignDailyRow,
  DailyMetrics,
} from './campaign-insights'

export { getAdsetDailyInsights } from './adset-insights'
export type { MetaAdsetDailyRow } from './adset-insights'

export { getAdDailyInsights } from './ad-insights'
export type { MetaAdDailyRow } from './ad-insights'

export {
  getCampaignDetails,
  setCampaignStatus,
  setCampaignDailyBudget,
} from './campaign-management'
export type { CampaignDetails } from './campaign-management'

export { boostPagePost } from './boost'
export type { BoostPostResult } from './boost'
