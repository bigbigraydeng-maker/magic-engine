/**
 * P21.K.2 — Ad Strategy Engine fatigue judgement (relative baseline).
 *
 * The heart of the "投放师大脑". It answers, for one campaign, the question the
 * absolute thresholds could not: "has this campaign decayed against its OWN
 * best week?" — because a real fatigue event proved absolute lines blind.
 *
 * The Reborn incident (2026-07): CTR fell 41% (4.2% → 2.5%) over three weeks
 * while frequency never left 1.1, so neither "frequency > 2.5" nor "CTR < 2%"
 * ever fired. A resurfacing-since-its-own-peak comparison catches exactly this.
 *
 * These are pure functions over a daily series. No I/O, no dates-from-now — so
 * they are fully deterministic and testable, and can be replayed against the
 * real Reborn numbers as a regression (see baseline.test.ts).
 */

/** One day of one campaign's metrics, as read from `ad_daily_insights`. */
export interface DailyPoint {
  insight_date: string   // YYYY-MM-DD
  ctr: number | null     // fraction (0.0318 = 3.18%)
  cost_per_result: number | null
  results: number
  spend: number
  impressions: number
}

// 'paused' = the campaign isn't delivering (stopped); a calendar-level status
// set by the evaluator, never produced by the per-metric fatigue judgement here.
export type Verdict = 'healthy' | 'watch' | 'alert' | 'insufficient_history' | 'paused'

/** Which direction a metric is "bad" in — CTR falling is bad, CPL rising is bad. */
type Direction = 'lower_is_worse' | 'higher_is_worse'

export interface BaselineConfig {
  /** Rolling window length, in days, for both the baseline and the recent read. */
  windowDays: number
  /** Minimum days of history before any verdict other than insufficient_history. */
  minHistoryDays: number
  /** Recent < baseline × alertRatio → alert (CTR side). Default 0.70 = down 30%. */
  ctrAlertRatio: number
  /** Recent < baseline × watchRatio → watch. Default 0.80 = down 20%. */
  ctrWatchRatio: number
  /** Recent > baseline × alertRatio → alert (CPL side). Default 1.40 = up 40%. */
  cplAlertRatio: number
  /** Recent > baseline × watchRatio → watch. Default 1.25 = up 25%. */
  cplWatchRatio: number
  /**
   * A `watch` that persists this many consecutive windows without recovering
   * escalates to `alert`. This is the "persistent, not single-day" discipline:
   * a campaign that has sat ~25–30% below its own peak for a week is fatigued,
   * even if the smoothed drop never quite crosses the one-shot alert line.
   * The real Reborn case is exactly this — a two-week 🟡 the median kept just
   * above 🔴; without escalation it would nag forever and never say "act".
   *
   * Unit is CONSECUTIVE WINDOWS, not calendar days. Windows overlap by
   * windowDays-1, so 7 breaching windows ≈ a week-plus of sustained decline
   * (each window is a 7-day median). Do not read "7" as "7 days".
   */
  escalateWatchAfterDays: number
}

export const DEFAULT_BASELINE_CONFIG: BaselineConfig = {
  windowDays: 7,
  minHistoryDays: 14,
  ctrAlertRatio: 0.70,
  ctrWatchRatio: 0.80,
  cplAlertRatio: 1.40,
  cplWatchRatio: 1.25,
  escalateWatchAfterDays: 7,
}

export interface MetricVerdict {
  metric: 'ctr' | 'cost_per_result'
  verdict: Verdict
  baseline: number | null   // the campaign's own best-window median
  recent: number | null     // its latest-window median
  ratio: number | null      // recent / baseline
  reason: string            // plain-language, PM-facing
}

export interface CampaignVerdict {
  verdict: Verdict          // worst of the metric verdicts
  metrics: MetricVerdict[]
  headline: string          // one-line, PM-facing summary of the worst metric
}

function median(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid]
}

/**
 * Slide a window of `windowDays` across the series and return every window's
 * median of the chosen metric. Windows are date-contiguous by position in the
 * sorted series; gaps in dates are tolerated (we window by count, not calendar,
 * which is fine because the pull writes one row per active day).
 */
function windowMedians(
  points: DailyPoint[],
  pick: (p: DailyPoint) => number | null,
  windowDays: number,
): number[] {
  const series = points.map(pick).map(v => (v == null ? NaN : v))
  const out: number[] = []
  for (let end = windowDays; end <= series.length; end++) {
    const m = median(series.slice(end - windowDays, end))
    if (m != null) out.push(m)
  }
  return out
}

function evaluateMetric(
  points: DailyPoint[],
  metric: 'ctr' | 'cost_per_result',
  direction: Direction,
  cfg: BaselineConfig,
): MetricVerdict {
  const pick = (p: DailyPoint) =>
    metric === 'ctr' ? p.ctr : p.cost_per_result

  // Count days that actually carry this metric — a campaign with no results has
  // no cost_per_result history and must not be judged on it.
  const withValue = points.filter(p => {
    const v = pick(p)
    return v != null && Number.isFinite(v)
  })

  if (withValue.length < cfg.minHistoryDays) {
    return {
      metric, verdict: 'insufficient_history',
      baseline: null, recent: null, ratio: null,
      reason: `历史不足 ${cfg.minHistoryDays} 天(现有 ${withValue.length} 天),暂不判定`,
    }
  }

  // Window over the DENSE sub-series (days that actually have this metric), not
  // the full calendar. For CTR this is a no-op (it is present almost every day),
  // but cost_per_result is sparse — many campaigns (ThruPlay, messaging pools)
  // have results only some days. Windowing over the raw series would let a
  // window holding a single cheap day become the Math.min baseline floor and
  // then flag a chronic false 🔴, and would let `recent` read a weeks-old
  // window when the latest days have no results. Densifying fixes both.
  const medians = windowMedians(withValue, pick, cfg.windowDays)
  if (medians.length < 2) {
    return {
      metric, verdict: 'insufficient_history',
      baseline: null, recent: null, ratio: null,
      reason: '可用窗口不足,暂不判定',
    }
  }

  const recent = medians[medians.length - 1]
  // Baseline = the campaign's OWN best window (best = healthiest, per direction).
  const baseline = direction === 'lower_is_worse'
    ? Math.max(...medians)   // best CTR week
    : Math.min(...medians)   // cheapest CPL week

  // A zero baseline (e.g. impressions but never a click for 14+ days) has no
  // meaningful ratio — treat as "can't judge" rather than silently 'healthy',
  // which would paint a dead campaign green.
  if (baseline <= 0) {
    return {
      metric, verdict: 'insufficient_history',
      baseline: null, recent: null, ratio: null,
      reason: '无有效基线(该指标长期为零),暂不判定',
    }
  }
  const ratio = recent / baseline

  const watchRatio = direction === 'lower_is_worse' ? cfg.ctrWatchRatio : cfg.cplWatchRatio
  const alertRatio = direction === 'lower_is_worse' ? cfg.ctrAlertRatio : cfg.cplAlertRatio
  const breaches = (r: number) =>
    direction === 'lower_is_worse' ? r < watchRatio : r > watchRatio
  const alerts = (r: number) =>
    direction === 'lower_is_worse' ? r < alertRatio : r > alertRatio

  const label = metric === 'ctr' ? '点击率' : '每个询盘成本'
  const pct = Math.round(Math.abs(1 - ratio) * 100)

  let verdict: Verdict = 'healthy'
  let escalated = false
  {
    if (alerts(ratio)) {
      verdict = 'alert'
    } else if (breaches(ratio)) {
      verdict = 'watch'
      // Escalate a persistent watch: count trailing windows (against their own
      // baselines) that have stayed in the watch zone without recovering.
      const streak = trailingBreachStreak(medians, baseline, breaches)
      if (streak >= cfg.escalateWatchAfterDays) {
        verdict = 'alert'
        escalated = true
      }
    }
  }

  const reason = buildMetricReason(verdict, escalated, label, direction, baseline, recent, pct)
  return { metric, verdict, baseline, recent, ratio, reason }
}

/**
 * How many of the most-recent windows have stayed in the watch zone without
 * recovering. Each window is compared to the SAME fixed baseline (the peak), so
 * a streak means "sustained underperformance vs the campaign's own best", which
 * is the real fatigue signal as opposed to a single bad day.
 */
function trailingBreachStreak(
  medians: number[],
  baseline: number,
  breaches: (ratio: number) => boolean,
): number {
  if (baseline === 0) return 0
  let streak = 0
  for (let i = medians.length - 1; i >= 0; i--) {
    if (breaches(medians[i] / baseline)) streak++
    else break
  }
  return streak
}

function buildMetricReason(
  verdict: Verdict,
  escalated: boolean,
  label: string,
  direction: Direction,
  baseline: number,
  recent: number,
  pct: number,
): string {
  if (verdict === 'healthy') return `${label}接近自身最好水平,健康`
  const move = direction === 'lower_is_worse'
    ? `低 ${pct}%(${fmtPct(baseline)} → ${fmtPct(recent)})`
    : `高 ${pct}%(${fmtMoney(baseline)} → ${fmtMoney(recent)})`
  const tail = escalated ? ',且已持续一周以上不恢复' : ''
  return `${label}比自身最好一周${move}${tail}`
}

function fmtPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}
function fmtMoney(v: number): string {
  return `$${v.toFixed(2)}`
}

const VERDICT_RANK: Record<Verdict, number> = {
  alert: 3, watch: 2, healthy: 1, insufficient_history: 0, paused: 0,
}

/**
 * Judge one campaign from its daily series (oldest → newest order not required;
 * sorted internally). Evaluates CTR (lower is worse) and cost-per-result
 * (higher is worse), then reports the worst of the two.
 */
export function judgeCampaign(
  points: DailyPoint[],
  cfg: BaselineConfig = DEFAULT_BASELINE_CONFIG,
): CampaignVerdict {
  const sorted = [...points].sort((a, b) =>
    a.insight_date < b.insight_date ? -1 : a.insight_date > b.insight_date ? 1 : 0,
  )

  const metrics = [
    evaluateMetric(sorted, 'ctr', 'lower_is_worse', cfg),
    evaluateMetric(sorted, 'cost_per_result', 'higher_is_worse', cfg),
  ]

  // Worst verdict wins, but insufficient_history only "wins" if EVERY metric is
  // insufficient — one real signal should still surface.
  const realVerdicts = metrics
    .map(m => m.verdict)
    .filter(v => v !== 'insufficient_history')
  const verdict: Verdict = realVerdicts.length === 0
    ? 'insufficient_history'
    : realVerdicts.reduce((worst, v) =>
        VERDICT_RANK[v] > VERDICT_RANK[worst] ? v : worst, 'healthy' as Verdict)

  return { verdict, metrics, headline: buildHeadline(verdict, metrics) }
}

function buildHeadline(verdict: Verdict, metrics: MetricVerdict[]): string {
  if (verdict === 'insufficient_history') return '数据积累中,暂不判定'
  if (verdict === 'healthy') return '健康,无需动手'
  const worst = metrics.find(m => m.verdict === verdict)
  return worst?.reason ?? '需要关注'
}
