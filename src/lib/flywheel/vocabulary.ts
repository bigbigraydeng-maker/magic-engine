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

/** SEO flywheel vocabulary — to be populated in Phase 12.B */
export const SEO_ACTION_TYPE = {} as const
export const SEO_METRIC_KEY  = {} as const

/** Ads flywheel vocabulary — to be populated in Phase 12.B */
export const ADS_ACTION_TYPE = {} as const
export const ADS_METRIC_KEY  = {} as const

/** Social flywheel vocabulary — to be populated in Phase 12.B */
export const SOCIAL_ACTION_TYPE = {} as const
export const SOCIAL_METRIC_KEY  = {} as const

// ── Union helpers ─────────────────────────────────────────────────────────────

/** All valid action_type strings across all flywheels */
export type FlywheelActionType = GeoActionType

/** All valid metric_key strings across all flywheels */
export type FlywheelMetricKey = GeoMetricKey

// ── Runtime validation helpers ────────────────────────────────────────────────

const ALL_GEO_ACTIONS = new Set<string>(Object.values(GEO_ACTION_TYPE))
const ALL_GEO_METRICS = new Set<string>(Object.values(GEO_METRIC_KEY))

export function isValidGeoActionType(value: string): value is GeoActionType {
  return ALL_GEO_ACTIONS.has(value)
}

export function isValidGeoMetricKey(value: string): value is GeoMetricKey {
  return ALL_GEO_METRICS.has(value)
}
