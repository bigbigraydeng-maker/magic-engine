/**
 * Flywheel vocabulary — controlled enumerations for action_type and metric_key.
 *
 * Phase 12.A covers GEO only. Other flywheels (seo, ads, social) are
 * defined as placeholder const objects and will be filled in Phase 12.B.
 *
 * Naming convention:
 *   action_type  →  "<flywheel>.<verb>_<noun>"   e.g. "geo.deploy_directive"
 *   metric_key   →  "<flywheel>.<noun>.<measure>" e.g. "geo.query.mention_rate"
 */

// ── GEO action types ──────────────────────────────────────────────────────────

/**
 * Actions the GEO flywheel can log in flywheel_actions.
 *
 * in_house actions  → executed inside Magic Engine (GeoComposerAdapter)
 * third_party       → coordinated via markisfact or similar
 * external_manual   → FDE completes outside the system, marks done manually
 */
export const GEO_ACTION_TYPE = {
  /** Generate a new GEO directive via Composer (in_house) */
  COMPOSE_DIRECTIVE: 'geo.compose_directive',

  /** Embed / deploy a generated directive to the client site (in_house) */
  DEPLOY_DIRECTIVE: 'geo.deploy_directive',

  /** Refresh an existing directive after new Tracker data arrives (in_house) */
  REFRESH_DIRECTIVE: 'geo.refresh_directive',

  /** Run an AI Visibility Tracker query batch (in_house) */
  TRACKER_RUN: 'geo.tracker_run',

  /** Submit brand entity data to a third-party GEO platform (third_party) */
  SUBMIT_ENTITY: 'geo.submit_entity',

  /** FDE manually builds citations / mentions on external sites (external_manual) */
  BUILD_CITATIONS: 'geo.build_citations',
} as const

export type GeoActionType = (typeof GEO_ACTION_TYPE)[keyof typeof GEO_ACTION_TYPE]

// ── GEO metric keys ───────────────────────────────────────────────────────────

/**
 * Measurable signals stored in flywheel_metrics for the GEO flywheel.
 *
 * Written by:
 *   - AI Tracker orchestrator   → QUERY_MENTION_RATE, QUERY_AVG_RANK, ENGINE_COVERAGE
 *   - Directive status checks   → DIRECTIVE_DEPLOYED, DIRECTIVE_SCENARIO_COUNT
 */
export const GEO_METRIC_KEY = {
  /** Fraction of tracked queries where the brand is mentioned (0–1) */
  QUERY_MENTION_RATE: 'geo.query.mention_rate',

  /** Average ranking position across all AI engines and queries (lower = better) */
  QUERY_AVG_RANK: 'geo.query.avg_rank',

  /** Number of distinct AI engines where the brand appeared at least once */
  ENGINE_COVERAGE: 'geo.engine.coverage',

  /** 1 if a GEO directive is currently live on the client site, 0 otherwise */
  DIRECTIVE_DEPLOYED: 'geo.directive.deployed',

  /** Number of scenarios defined in the active GEO directive */
  DIRECTIVE_SCENARIO_COUNT: 'geo.directive.scenario_count',
} as const

export type GeoMetricKey = (typeof GEO_METRIC_KEY)[keyof typeof GEO_METRIC_KEY]

// ── Placeholder stubs for other flywheels (Phase 12.B) ───────────────────────

// ── SEO action types ──────────────────────────────────────────────────────────

/**
 * Actions the SEO flywheel can log in flywheel_actions.
 *
 * in_house actions  → executed inside Magic Engine (SeoContentAdapter)
 * external_manual   → FDE completes off-platform (e.g. link building)
 */
export const SEO_ACTION_TYPE = {
  /** Generate and persist a new blog post targeting a keyword (in_house) */
  PUBLISH_BLOG: 'seo.publish_blog',

  /** Re-optimise an existing blog post after keyword data refreshes (in_house) */
  REFRESH_BLOG: 'seo.refresh_blog',

  /** Pull a fresh SEMrush domain snapshot into flywheel_metrics (in_house) */
  SEMRUSH_SNAPSHOT: 'seo.semrush_snapshot',

  /** FDE manually builds back-links on external sites (external_manual) */
  BUILD_BACKLINKS: 'seo.build_backlinks',
} as const

export type SeoActionType = (typeof SEO_ACTION_TYPE)[keyof typeof SEO_ACTION_TYPE]

// ── SEO metric keys ───────────────────────────────────────────────────────────

/**
 * Measurable signals stored in flywheel_metrics for the SEO flywheel.
 *
 * Written by:
 *   - SeoContentAdapter.pullMetrics() via SEMrush domain_ranks API
 *   - Blog publish hooks via SeoContentAdapter.execute()
 */
export const SEO_METRIC_KEY = {
  /** Total number of organic keywords the domain ranks for (SEMrush Or) */
  ORGANIC_KEYWORDS: 'seo.domain.organic_keywords',

  /** Estimated monthly organic traffic (SEMrush Ot) */
  ORGANIC_TRAFFIC: 'seo.domain.organic_traffic',

  /** SEMrush Authority Score 0–100 (SEMrush As) */
  AUTHORITY_SCORE: 'seo.domain.authority_score',

  /** Count of published blog posts tracked in blog_posts table */
  PUBLISHED_POSTS: 'seo.content.published_posts',

  // ── GSC-backed attribution metrics (P17.A.4) ──────────────────────────────

  /** Total GSC clicks over the 28-day snapshot window */
  GSC_CLICKS: 'seo.gsc.clicks',

  /** Total GSC impressions over the 28-day snapshot window */
  GSC_IMPRESSIONS: 'seo.gsc.impressions',

  /** Average ranking position across all tracked queries (lower = better) */
  GSC_AVG_POSITION: 'seo.gsc.avg_position',
} as const

export type SeoMetricKey = (typeof SEO_METRIC_KEY)[keyof typeof SEO_METRIC_KEY]

// ── Ads action types ──────────────────────────────────────────────────────────

/**
 * Actions the Ads flywheel can log in flywheel_actions.
 *
 * third_party actions → coordinated via Meta Ads Manager (MetaAdsAdapter)
 * These map to CLAUDE.md "Fix" boundary: pause/bid/negative = auto-executable.
 */
export const ADS_ACTION_TYPE = {
  /** Pause a losing campaign to stop budget bleed (third_party, meta) */
  PAUSE_CAMPAIGN: 'ads.pause_campaign',

  /** Pause an underperforming ad set (third_party, meta) */
  PAUSE_AD_SET: 'ads.pause_ad_set',

  /** Pause an underperforming individual ad (third_party, meta) */
  PAUSE_AD: 'ads.pause_ad',

  /** Adjust bid for an ad set (third_party, meta) */
  ADJUST_BID: 'ads.adjust_bid',

  /** Add a negative keyword to stop wasted spend (third_party, meta) */
  ADD_NEGATIVE_KEYWORD: 'ads.add_negative_keyword',

  /** Pull a fresh Meta Ads snapshot into flywheel_metrics (third_party, meta) */
  META_SNAPSHOT: 'ads.meta_snapshot',

  /** Re-enable a paused TikTok campaign (undo of PAUSE_CAMPAIGN) */
  REACTIVATE_CAMPAIGN: 'ads.reactivate_campaign',
} as const

export type AdsActionType = (typeof ADS_ACTION_TYPE)[keyof typeof ADS_ACTION_TYPE]

// ── Ads metric keys ───────────────────────────────────────────────────────────

/**
 * Measurable signals stored in flywheel_metrics for the Ads flywheel.
 *
 * Written by MetaAdsAdapter.pullMetrics() via meta_ads_snapshots table.
 */
export const ADS_METRIC_KEY = {
  /** Return on Ad Spend (revenue / spend) */
  ROAS: 'ads.account.roas',

  /** Total ad spend in account currency for the period */
  SPEND: 'ads.account.spend',

  /** Total impressions served */
  IMPRESSIONS: 'ads.account.impressions',

  /** Total link clicks */
  CLICKS: 'ads.account.clicks',

  /** Cost per click (spend / clicks) */
  CPC: 'ads.account.cpc',

  /** Click-through rate (clicks / impressions, 0–1) */
  CTR: 'ads.account.ctr',

  /** Total conversion events (purchases, leads, etc.) */
  CONVERSIONS: 'ads.account.conversions',
} as const

export type AdsMetricKey = (typeof ADS_METRIC_KEY)[keyof typeof ADS_METRIC_KEY]

// ── Social action types ───────────────────────────────────────────────────────

/**
 * Actions the Social flywheel can log in flywheel_actions.
 *
 * in_house actions  → content generated inside Magic Engine (SocialContentAdapter)
 * third_party       → published / scheduled via Publer
 */
export const SOCIAL_ACTION_TYPE = {
  /** Generate social media captions / copy for a campaign post (in_house) */
  GENERATE_CONTENT: 'social.generate_content',

  /** Schedule a post to be published via Publer at a future time (third_party, publer) */
  SCHEDULE_POST: 'social.schedule_post',

  /** Publish a post immediately via Publer (third_party, publer) */
  PUBLISH_POST: 'social.publish_post',
} as const

export type SocialActionType = (typeof SOCIAL_ACTION_TYPE)[keyof typeof SOCIAL_ACTION_TYPE]

// ── Social metric keys ────────────────────────────────────────────────────────

/**
 * Measurable signals stored in flywheel_metrics for the Social flywheel.
 *
 * Written by SocialContentAdapter.pullMetrics() from content_posts table.
 */
export const SOCIAL_METRIC_KEY = {
  /** Count of content_posts with status = 'published' */
  PUBLISHED_COUNT: 'social.posts.published_count',

  /** Count of content_posts with status = 'scheduled' */
  SCHEDULED_COUNT: 'social.posts.scheduled_count',

  // ── Per-post engagement (P12.C.3 — pulled from Publer daily) ─────────────

  /** Like / reaction count for a specific published post */
  POST_LIKES: 'social.post.likes',

  /** Comment count for a specific published post */
  POST_COMMENTS: 'social.post.comments',

  /** Share / retweet count for a specific published post */
  POST_SHARES: 'social.post.shares',
} as const

export type SocialMetricKey = (typeof SOCIAL_METRIC_KEY)[keyof typeof SOCIAL_METRIC_KEY]

// ── Union helpers ─────────────────────────────────────────────────────────────

/** All valid action_type strings across all flywheels */
export type FlywheelActionType = GeoActionType | SeoActionType | AdsActionType | SocialActionType

/** All valid metric_key strings across all flywheels */
export type FlywheelMetricKey = GeoMetricKey | SeoMetricKey | AdsMetricKey | SocialMetricKey

// ── Runtime validation helpers ────────────────────────────────────────────────

const ALL_GEO_ACTIONS    = new Set<string>(Object.values(GEO_ACTION_TYPE))
const ALL_GEO_METRICS    = new Set<string>(Object.values(GEO_METRIC_KEY))
const ALL_SEO_ACTIONS    = new Set<string>(Object.values(SEO_ACTION_TYPE))
const ALL_SEO_METRICS    = new Set<string>(Object.values(SEO_METRIC_KEY))
const ALL_ADS_ACTIONS    = new Set<string>(Object.values(ADS_ACTION_TYPE))
const ALL_ADS_METRICS    = new Set<string>(Object.values(ADS_METRIC_KEY))
const ALL_SOCIAL_ACTIONS = new Set<string>(Object.values(SOCIAL_ACTION_TYPE))
const ALL_SOCIAL_METRICS = new Set<string>(Object.values(SOCIAL_METRIC_KEY))

export function isValidGeoActionType(value: string): value is GeoActionType {
  return ALL_GEO_ACTIONS.has(value)
}

export function isValidGeoMetricKey(value: string): value is GeoMetricKey {
  return ALL_GEO_METRICS.has(value)
}

export function isValidSeoActionType(value: string): value is SeoActionType {
  return ALL_SEO_ACTIONS.has(value)
}

export function isValidSeoMetricKey(value: string): value is SeoMetricKey {
  return ALL_SEO_METRICS.has(value)
}

export function isValidAdsActionType(value: string): value is AdsActionType {
  return ALL_ADS_ACTIONS.has(value)
}

export function isValidAdsMetricKey(value: string): value is AdsMetricKey {
  return ALL_ADS_METRICS.has(value)
}

export function isValidSocialActionType(value: string): value is SocialActionType {
  return ALL_SOCIAL_ACTIONS.has(value)
}

export function isValidSocialMetricKey(value: string): value is SocialMetricKey {
  return ALL_SOCIAL_METRICS.has(value)
}
