/**
 * Shared types for the SEO Patrol subsystem (Phase 22.E).
 *
 * SEO patrol rule engine (pure rules, no AI) → SeoPatrolFinding[]
 *   ↓ persisted to seo_patrol_findings table (status='fresh')
 * 诸葛亮 consumes fresh findings → persistZhugeActions() → execution_items
 *
 * Distinct from the AnomalyDetector (Phase 22.D): the anomaly detector finds
 * metric DROPS in flywheel_metrics; this finds SEO OPPORTUNITIES from
 * per-keyword keyword_snapshots and per-page gsc_performance_snapshots.
 *
 * Reference: docs/seo-sop-implementation-design.md
 */

/** Rule identifiers. Keep in sync with the seo_patrol_rule enum in migration. */
export type SeoPatrolRuleId =
  | 'low_ctr_title'
  | 'missing_internal_link'
  | 'stale_content'
  | 'keyword_opportunity'
  | 'not_indexed'

/**
 * One opportunity finding — one row per triggered rule per subject (keyword/url).
 * Mirrors the seo_patrol_findings table columns.
 */
export interface SeoPatrolFinding {
  clientId: string
  ruleId: SeoPatrolRuleId
  /** Keyword subject (R1/R3/R4). null when the finding is page-scoped. */
  keyword: string | null
  /** Page URL subject (R2/R5). null when the finding is keyword-scoped. */
  url: string | null

  // Signals captured at detection time (which are set depends on the rule).
  position: number | null
  ctr: number | null
  ctrBenchmark: number | null
  searchVolume: number | null
  keywordDifficulty: number | null
  positionDelta: number | null

  /** The flywheel action_type this finding becomes if 诸葛亮 acts on it. */
  suggestedActionType: string
  /** Human-readable summary for the kanban card + 诸葛亮 context. */
  description: string
}

// ── Rule input shapes ───────────────────────────────────────────────────────
// Normalised data the rule engine feeds into each rule. The engine is
// responsible for reading keyword_snapshots / gsc_performance_snapshots and
// shaping the rows into these structures; rules stay pure.

/** One keyword's current + prior ranking, merged with GSC CTR if available. */
export interface KeywordSignal {
  keyword: string
  /** Current SERP position (lower = better). null = unranked. */
  position: number | null
  /** Position in the prior snapshot, for stale-content detection. */
  priorPosition: number | null
  searchVolume: number | null
  keywordDifficulty: number | null
  /** Actual GSC click-through rate (0..1) for this query, if matched. */
  gscCtr: number | null
  /** True when the client already has a page ranking for this keyword. */
  covered: boolean
}

/** One page's GSC performance, used by page-scoped rules. */
export interface PageSignal {
  url: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  /** True when an internal link from another page points here. */
  hasInternalLink: boolean
  /** True when GSC reports this URL as "discovered - currently not indexed". */
  discoveredNotIndexed: boolean
  /** Days since the URL was first discovered but not indexed (R5). */
  daysNotIndexed: number | null
}

/** Everything a single rule needs to evaluate one client. */
export interface SeoPatrolInput {
  clientId: string
  keywords: KeywordSignal[]
  pages: PageSignal[]
}

/**
 * A single SEO patrol rule. Pure-functional: given a client's signals, emit
 * zero or more findings. No I/O, no AI.
 */
export interface SeoPatrolRule {
  id: SeoPatrolRuleId
  /** action_type the resulting execution_item should carry. */
  suggestedActionType: string
  evaluate(input: SeoPatrolInput): SeoPatrolFinding[]
}
