/**
 * Data Intelligence — Insight rule engine (Phase 22.B.4).
 *
 * Generates structured InsightCard[] from trend series + anomaly signals.
 * All functions are pure (no I/O).
 *
 * Four MVP rules:
 *   1. positive-momentum   — week-on-week > +15% on higher_is_better metric
 *   2. concerning-decline  — week-on-week < -15% on higher_is_better metric
 *      (or +15% on lower_is_better, e.g. avg_position getting worse)
 *   3. data-gap            — ≥ 3 consecutive day-buckets missing
 *   4. anomaly-bridge      — bridge anomaly_signals table rows → InsightCard
 *
 * Boundary with 22.D AnomalyDetectorJob:
 *   - 22.D writes to anomaly_signals and generates execution_items (action-oriented)
 *   - 22.B READS anomaly_signals and renders them as InsightCards (display-oriented)
 *   - 22.B also adds positive-momentum + data-gap rules (things 22.D never checks)
 *   - 22.B NEVER writes to anomaly_signals
 */

import type { TrendSeries, InsightCard, InsightSeverity } from './types'

// ─── Anomaly signal shape (minimal, matches DB row) ──────────────────────────

export interface AnomalySignalRow {
  id:             string
  client_id:      string
  flywheel:       string
  metric_key:     string
  rule_id:        string
  severity:       'high' | 'medium' | 'low'
  current_value:  number
  reference_value: number
  delta_pct:      number
  description:    string
  created_at:     string
}

// ─── Rule constants ───────────────────────────────────────────────────────────

const MOMENTUM_THRESHOLD_PCT = 15   // > +15% = positive momentum
const DECLINE_THRESHOLD_PCT  = -15  // < -15% = concerning decline
const DATA_GAP_DAYS          = 3    // ≥ 3 consecutive missing buckets = gap

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate InsightCards from trend series + anomaly signals.
 * Cards are deduplicated and sorted by severity (high → positive → medium → low).
 *
 * @param series          Output of bucketByGranularity for the client's metrics
 * @param anomalySignals  Fresh anomaly_signals rows for this client (may be empty)
 * @param clientId        Used to build stable card IDs
 */
export function generateInsights(
  series:         TrendSeries[],
  anomalySignals: AnomalySignalRow[],
  clientId:       string,
): InsightCard[] {
  const cards: InsightCard[] = []

  // 1. anomaly-bridge: render 22.D signals as InsightCards
  for (const signal of anomalySignals) {
    cards.push(anomalyBridge(signal))
  }

  // 2. positive-momentum + concerning-decline + data-gap from trend data
  for (const s of series) {
    const momentum = evaluateMomentum(s, clientId)
    if (momentum) cards.push(momentum)

    const gap = evaluateDataGap(s, clientId)
    if (gap) cards.push(gap)
  }

  // Deduplicate by card.id
  const seen   = new Set<string>()
  const unique = cards.filter(c => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })

  return sortByPriority(unique)
}

// ─── Rule implementations ─────────────────────────────────────────────────────

/**
 * Rule 1 & 2: positive-momentum / concerning-decline.
 * Fires when 7-day delta exceeds threshold in either direction.
 * Returns null if insufficient data.
 */
function evaluateMomentum(s: TrendSeries, clientId: string): InsightCard | null {
  const delta = s.deltaPct7d
  if (delta === null) return null

  const today = new Date().toISOString().slice(0, 10)

  // Positive momentum: higher_is_better and delta > threshold
  if (s.direction === 'higher_is_better' && delta >= MOMENTUM_THRESHOLD_PCT) {
    return {
      id:           `positive-momentum::${clientId}::${s.metricKey}::${today}`,
      severity:     'positive',
      flywheel:     s.flywheel,
      metricKey:    s.metricKey,
      headline:     `${s.label} up ${formatDelta(delta)} week-on-week`,
      body:         `${s.label} has risen ${formatDelta(delta)} compared to 7 days ago — a positive trend worth noting.`,
      deltaPct:     delta,
      currentValue: s.points.length > 0 ? s.points[s.points.length - 1].value : null,
      asOf:         new Date().toISOString(),
      sourceRule:   'positive-momentum',
    }
  }

  // Concerning decline: higher_is_better and delta < threshold
  if (s.direction === 'higher_is_better' && delta <= DECLINE_THRESHOLD_PCT) {
    return {
      id:           `concerning-decline::${clientId}::${s.metricKey}::${today}`,
      severity:     'medium',
      flywheel:     s.flywheel,
      metricKey:    s.metricKey,
      headline:     `${s.label} dropped ${formatDelta(delta)} week-on-week`,
      body:         `${s.label} has fallen ${formatDelta(Math.abs(delta))} compared to 7 days ago. Consider reviewing recent changes.`,
      deltaPct:     delta,
      currentValue: s.points.length > 0 ? s.points[s.points.length - 1].value : null,
      asOf:         new Date().toISOString(),
      sourceRule:   'concerning-decline',
    }
  }

  // Positive momentum for lower_is_better (e.g. avg_position dropping = good)
  if (s.direction === 'lower_is_better' && delta <= -MOMENTUM_THRESHOLD_PCT) {
    return {
      id:           `positive-momentum::${clientId}::${s.metricKey}::${today}`,
      severity:     'positive',
      flywheel:     s.flywheel,
      metricKey:    s.metricKey,
      headline:     `${s.label} improved ${formatDelta(Math.abs(delta))} week-on-week`,
      body:         `${s.label} has improved by ${formatDelta(Math.abs(delta))} compared to 7 days ago.`,
      deltaPct:     delta,
      currentValue: s.points.length > 0 ? s.points[s.points.length - 1].value : null,
      asOf:         new Date().toISOString(),
      sourceRule:   'positive-momentum',
    }
  }

  // Concerning decline for lower_is_better (e.g. avg_position rising = bad)
  if (s.direction === 'lower_is_better' && delta >= MOMENTUM_THRESHOLD_PCT) {
    return {
      id:           `concerning-decline::${clientId}::${s.metricKey}::${today}`,
      severity:     'medium',
      flywheel:     s.flywheel,
      metricKey:    s.metricKey,
      headline:     `${s.label} worsened ${formatDelta(delta)} week-on-week`,
      body:         `${s.label} has worsened by ${formatDelta(delta)} compared to 7 days ago.`,
      deltaPct:     delta,
      currentValue: s.points.length > 0 ? s.points[s.points.length - 1].value : null,
      asOf:         new Date().toISOString(),
      sourceRule:   'concerning-decline',
    }
  }

  return null
}

/**
 * Rule 3: data-gap.
 * Fires when the series has ≥ DATA_GAP_DAYS consecutive missing day-buckets.
 */
function evaluateDataGap(s: TrendSeries, clientId: string): InsightCard | null {
  if (!s.hasDataGap) return null

  const today = new Date().toISOString().slice(0, 10)

  return {
    id:           `data-gap::${clientId}::${s.metricKey}::${today}`,
    severity:     'low',
    flywheel:     s.flywheel,
    metricKey:    s.metricKey,
    headline:     `${s.label} has a data gap`,
    body:         `${s.label} is missing ${DATA_GAP_DAYS}+ consecutive days of data. Check connector health in settings.`,
    deltaPct:     null,
    currentValue: s.points.length > 0 ? s.points[s.points.length - 1].value : null,
    asOf:         new Date().toISOString(),
    sourceRule:   'data-gap',
  }
}

/**
 * Rule 4: anomaly-bridge.
 * Converts an anomaly_signals row into an InsightCard.
 * Severity mapping: 22.D uses 'high'/'medium'/'low'; 22.B adds 'positive'.
 */
function anomalyBridge(signal: AnomalySignalRow): InsightCard {
  return {
    id:           `anomaly-bridge::${signal.client_id}::${signal.rule_id}::${signal.created_at.slice(0, 10)}`,
    severity:     signal.severity as InsightSeverity,
    flywheel:     signal.flywheel as InsightCard['flywheel'],
    metricKey:    signal.metric_key,
    headline:     signal.description,
    body:         buildAnomalyBody(signal),
    deltaPct:     signal.delta_pct,
    currentValue: signal.current_value,
    asOf:         signal.created_at,
    sourceRule:   signal.rule_id,
    ctaHref:      undefined,
  }
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  high:     0,
  positive: 1,
  medium:   2,
  low:      3,
}

function sortByPriority(cards: InsightCard[]): InsightCard[] {
  return [...cards].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4),
  )
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatDelta(pct: number): string {
  const abs = Math.abs(pct)
  return `${abs.toFixed(1)}%`
}

function buildAnomalyBody(signal: AnomalySignalRow): string {
  const direction = signal.delta_pct >= 0 ? 'up' : 'down'
  const absPct    = Math.abs(signal.delta_pct).toFixed(1)
  return `${signal.description} — current value: ${signal.current_value.toFixed(2)}, ${direction} ${absPct}% vs reference ${signal.reference_value.toFixed(2)}.`
}
