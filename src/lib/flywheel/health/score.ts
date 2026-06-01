/**
 * Flywheel health score calculation — Phase 22.B.4
 *
 * Pure functions; all DB access lives in the API route.
 *
 * Algorithm:
 *   - 4 flywheels × 25 points each = 100 max
 *   - Per flywheel: compare latest value vs 30-day rolling average
 *   - Trend scoring: no data → neutral (12.5); improving → higher; degrading → lower
 *   - Active anomaly penalty: subtract 2 per fresh anomaly signal (max -20 total)
 *   - Result clamped [0, 100]
 *
 * Scoring bands:
 *   75–100  Healthy  🟢
 *   50–74   Fair     🟡
 *   25–49   At risk  🟠
 *   0–24    Critical 🔴
 */

export type FlywheelName = 'seo' | 'geo' | 'ads' | 'social'

export interface MetricSnapshot {
  metric_key: string
  metric_value: number
}

/** One data point per metric_key: most recent value + 30-day rolling average */
export interface FlywheelMetricStats {
  metricKey: string
  latest: number
  avg30d: number
  /** true when the metric is "lower = better" (e.g. avg_position, bounce_rate) */
  lowerIsBetter: boolean
}

export interface FlywheelScore {
  flywheel: FlywheelName
  /** 0–25 points */
  score: number
  /** true when there were no metrics available for this flywheel */
  noData: boolean
}

export interface HealthScoreResult {
  /** 0–100 overall health score */
  total: number
  /** Textual band */
  band: 'healthy' | 'fair' | 'at_risk' | 'critical'
  /** Per-flywheel breakdown */
  breakdown: FlywheelScore[]
  /** Number of fresh anomaly signals used in penalty calculation */
  activeAnomalies: number
  /** Points deducted from anomaly signals (0–20) */
  anomalyPenalty: number
}

// ── Which metric keys to track per flywheel, and their direction ──────────────

export const HEALTH_METRICS: Record<FlywheelName, { key: string; lowerIsBetter: boolean }[]> = {
  seo: [
    { key: 'seo.gsc.clicks',        lowerIsBetter: false },
    { key: 'seo.gsc.avg_position',   lowerIsBetter: true  }, // lower rank number = better
    { key: 'seo.ga4.sessions',       lowerIsBetter: false },
    { key: 'seo.ga4.bounce_rate',    lowerIsBetter: true  },
  ],
  geo: [
    { key: 'geo.query.mention_rate', lowerIsBetter: false },
    { key: 'geo.query.avg_rank',     lowerIsBetter: true  },
  ],
  ads: [
    { key: 'ads.account.roas',       lowerIsBetter: false },
    { key: 'ads.account.cpa',        lowerIsBetter: true  }, // pending ADS_METRIC_KEY.CPA (P18.B vocab)
    { key: 'ads.account.ctr',        lowerIsBetter: false },
  ],
  social: [
    { key: 'social.account.engagement_rate', lowerIsBetter: false }, // pending SOCIAL_METRIC_KEY.ENGAGEMENT_RATE (P18.B vocab)
    { key: 'social.posts.published_count',   lowerIsBetter: false },
  ],
}

// ── Pure scoring helpers ───────────────────────────────────────────────────────

const FLYWHEEL_MAX_SCORE = 25
const NEUTRAL_SCORE      = FLYWHEEL_MAX_SCORE / 2 // 12.5 — used when no data

/**
 * Score a single metric's trend: returns a value 0–1.
 * +5% or better improvement → 1.0 (full score)
 * -5% or worse degradation  → 0.0 (zero score)
 * Between -5% and +5%       → linear interpolation around 0.5
 */
export function scoreMetricTrend(
  latest: number,
  avg30d: number,
  lowerIsBetter: boolean,
): number {
  if (avg30d === 0) return 0.5 // avoid division by zero → neutral
  const rawPct = (latest - avg30d) / avg30d // signed pct change
  // If lower is better, invert the sign so "improvement" is always positive
  const pct = lowerIsBetter ? -rawPct : rawPct
  // Map [-0.05, +0.05] → [0, 1]; clamp outside
  const normalised = (pct + 0.05) / 0.10
  return Math.max(0, Math.min(1, normalised))
}

/**
 * Score a single flywheel given metric stats.
 * Returns 0–25.
 */
export function scoreFlywheelMetrics(
  flywheel: FlywheelName,
  stats: FlywheelMetricStats[],
): FlywheelScore {
  if (stats.length === 0) {
    return { flywheel, score: NEUTRAL_SCORE, noData: true }
  }

  const individualScores = stats.map(s =>
    scoreMetricTrend(s.latest, s.avg30d, s.lowerIsBetter),
  )
  // Average across metrics, then scale to 0–25
  const avg = individualScores.reduce((s, v) => s + v, 0) / individualScores.length
  return {
    flywheel,
    score: avg * FLYWHEEL_MAX_SCORE,
    noData: false,
  }
}

/**
 * Compute the anomaly penalty: 2 points per fresh anomaly, capped at 20.
 */
export function computeAnomalyPenalty(freshAnomalyCount: number): number {
  return Math.min(freshAnomalyCount * 2, 20)
}

/**
 * Determine the health band from a score 0–100.
 */
export function scoreToBand(score: number): HealthScoreResult['band'] {
  if (score >= 75) return 'healthy'
  if (score >= 50) return 'fair'
  if (score >= 25) return 'at_risk'
  return 'critical'
}

/**
 * Assemble the final HealthScoreResult from per-flywheel scores and
 * the number of active anomaly signals.
 */
export function buildHealthScore(
  flywheelScores: FlywheelScore[],
  freshAnomalyCount: number,
): HealthScoreResult {
  const rawTotal     = flywheelScores.reduce((s, f) => s + f.score, 0)
  const penalty      = computeAnomalyPenalty(freshAnomalyCount)
  const total        = Math.max(0, Math.min(100, rawTotal - penalty))

  return {
    total: Math.round(total),
    band: scoreToBand(total),
    breakdown: flywheelScores,
    activeAnomalies: freshAnomalyCount,
    anomalyPenalty: penalty,
  }
}
