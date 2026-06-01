/**
 * Built-in anomaly detection rules (Phase 22.D MVP + Phase 22.B.1 extension).
 *
 * Each rule is pure-functional: detect(current, history) → result | null.
 * No I/O, no AI. The AnomalyDetectorJob feeds metric data into these rules.
 *
 * Rule table from ROADMAP.md § Phase 22.D:
 *
 * Flywheel | Metric              | Threshold                    | Severity
 * ---------|---------------------|------------------------------|--------
 * SEO      | avg_position        | drop > 5 pos (3-day avg)     | high
 * GEO      | ai_visibility_score | drop > 15% (latest vs prior) | high
 * Ads      | Meta CPA            | rise > 30% (WoW)             | high
 * Social   | engagement_rate     | drop > 40% (WoW)             | medium
 * SEO      | total_clicks        | drop > 20% (WoW)             | medium
 *
 * P22.B.1 additions:
 * SEO      | ga4.sessions        | drop > 20% (WoW)             | medium
 * SEO      | ga4.bounce_rate     | rise > 15% (WoW)             | low
 */

import type { AnomalyRule } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function pctChange(current: number, reference: number): number {
  if (reference === 0) return 0
  return ((current - reference) / reference) * 100
}

/** Rolling average of the last N values (including current). */
function rollingAvg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

// ── Rule definitions ──────────────────────────────────────────────────────────

/** SEO-01: Average ranking position drops > 5 places (3-day rolling average). */
const seoAvgPositionDrop: AnomalyRule = {
  id: 'seo-avg-position-drop',
  flywheel: 'seo',
  metricKey: 'seo.gsc.avg_position',
  severity: 'high',
  detect(current, history) {
    // Need at least 3 prior data points to form a reference window
    if (history.length < 3) return null
    const reference = rollingAvg(history.slice(-3))
    // Higher position number = worse ranking
    const drop = current - reference
    if (drop <= 5) return null
    const deltaPct = pctChange(current, reference)
    return {
      deltaPct,
      description:
        `SEO ranking dropped ${drop.toFixed(1)} positions ` +
        `(now ${current.toFixed(1)}, was avg ${reference.toFixed(1)} over last 3 snapshots).`,
    }
  },
}

/** GEO-01: AI visibility score drops > 15% (latest vs prior snapshot). */
const geoVisibilityDrop: AnomalyRule = {
  id: 'geo-visibility-score-drop',
  flywheel: 'geo',
  metricKey: 'geo.query.mention_rate',
  severity: 'high',
  detect(current, history) {
    if (history.length === 0) return null
    const reference = history[history.length - 1]
    const deltaPct = pctChange(current, reference)
    if (deltaPct > -15) return null
    return {
      deltaPct,
      description:
        `GEO mention rate dropped ${Math.abs(deltaPct).toFixed(1)}% ` +
        `(now ${(current * 100).toFixed(1)}%, was ${(reference * 100).toFixed(1)}%).`,
    }
  },
}

/** Ads-01: Meta CPA rises > 30% week-over-week. */
const adsCpaSpike: AnomalyRule = {
  id: 'ads-cpa-spike',
  flywheel: 'ads',
  // CPA = spend / conversions — stored as a derived metric key
  metricKey: 'ads.account.cpa',
  severity: 'high',
  detect(current, history) {
    // Use 7-day trailing average as WoW reference
    if (history.length < 7) return null
    const reference = rollingAvg(history.slice(-7))
    const deltaPct = pctChange(current, reference)
    if (deltaPct <= 30) return null
    return {
      deltaPct,
      description:
        `Meta CPA rose ${deltaPct.toFixed(1)}% ` +
        `(now $${current.toFixed(2)}, 7-day avg was $${reference.toFixed(2)}).`,
    }
  },
}

/** Social-01: Engagement rate drops > 40% week-over-week. */
const socialEngagementDrop: AnomalyRule = {
  id: 'social-engagement-rate-drop',
  flywheel: 'social',
  metricKey: 'social.account.engagement_rate',
  severity: 'medium',
  detect(current, history) {
    if (history.length < 7) return null
    const reference = rollingAvg(history.slice(-7))
    const deltaPct = pctChange(current, reference)
    if (deltaPct > -40) return null
    return {
      deltaPct,
      description:
        `Social engagement rate dropped ${Math.abs(deltaPct).toFixed(1)}% ` +
        `(now ${(current * 100).toFixed(2)}%, 7-day avg was ${(reference * 100).toFixed(2)}%).`,
    }
  },
}

/** SEO-02: Total GSC clicks drop > 20% week-over-week. */
const seoClicksDrop: AnomalyRule = {
  id: 'seo-clicks-drop',
  flywheel: 'seo',
  metricKey: 'seo.gsc.clicks',
  severity: 'medium',
  detect(current, history) {
    if (history.length < 7) return null
    const reference = rollingAvg(history.slice(-7))
    const deltaPct = pctChange(current, reference)
    if (deltaPct > -20) return null
    return {
      deltaPct,
      description:
        `GSC clicks dropped ${Math.abs(deltaPct).toFixed(1)}% ` +
        `(now ${current.toFixed(0)}, 7-day avg was ${reference.toFixed(0)}).`,
    }
  },
}

/** SEO-03: GA4 sessions drop > 20% week-over-week (P22.B.1). */
const seoGa4SessionsDrop: AnomalyRule = {
  id: 'seo-ga4-sessions-drop',
  flywheel: 'seo',
  metricKey: 'seo.ga4.sessions',
  severity: 'medium',
  detect(current, history) {
    if (history.length < 7) return null
    const reference = rollingAvg(history.slice(-7))
    const deltaPct = pctChange(current, reference)
    if (deltaPct > -20) return null
    return {
      deltaPct,
      description:
        `GA4 sessions dropped ${Math.abs(deltaPct).toFixed(1)}% ` +
        `(now ${current.toFixed(0)}, 7-day avg was ${reference.toFixed(0)}).`,
    }
  },
}

/** SEO-04: GA4 bounce rate spikes > 15% week-over-week (P22.B.1). */
const seoGa4BounceRateSpike: AnomalyRule = {
  id: 'seo-ga4-bounce-rate-spike',
  flywheel: 'seo',
  metricKey: 'seo.ga4.bounce_rate',
  severity: 'low',
  detect(current, history) {
    // Bounce rate is 0–1; higher = worse
    if (history.length < 7) return null
    const reference = rollingAvg(history.slice(-7))
    const deltaPct = pctChange(current, reference)
    if (deltaPct <= 15) return null
    return {
      deltaPct,
      description:
        `GA4 bounce rate rose ${deltaPct.toFixed(1)}% ` +
        `(now ${(current * 100).toFixed(1)}%, 7-day avg was ${(reference * 100).toFixed(1)}%).`,
    }
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────

/** All built-in rules. Add new rules here to enrol them in the detector. */
export const ANOMALY_RULES: readonly AnomalyRule[] = [
  seoAvgPositionDrop,
  geoVisibilityDrop,
  adsCpaSpike,
  socialEngagementDrop,
  seoClicksDrop,
  seoGa4SessionsDrop,
  seoGa4BounceRateSpike,
]

/** Unique metric keys that any rule needs, grouped by flywheel. */
export const MONITORED_METRICS: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(
    ANOMALY_RULES.reduce<Record<string, string[]>>((acc, rule) => {
      const key = rule.flywheel
      if (!acc[key]) acc[key] = []
      if (!acc[key].includes(rule.metricKey)) acc[key].push(rule.metricKey)
      return acc
    }, {})
  )
)
