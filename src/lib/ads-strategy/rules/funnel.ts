/**
 * 广告级规则 · 漏斗逐步判定（纯函数，无 I/O）。
 *
 * 一条广告拆成「曝光→点击」「点击→结果」两步，每步拿近 3 天跟对照期比：
 * 样本够不够看上游（期望数），掉没掉看降幅 + 持续性 + 单侧 Fisher。
 * 巡检（D2/D10）用；阶段 2 客户侧分析器也喂同一形状的按天数据。
 */

import { fisherLowerTailP } from './stats'

/** Recent window length (days, ending on the evaluation day). */
export const RULE_RECENT_DAYS = 3
/** Baseline window length (days immediately before the recent window). */
export const RULE_BASELINE_DAYS = 14
/** Own-history baseline ignores the ad's first N delivery days (new-ad honeymoon CTR). */
export const RULE_HONEYMOON_DAYS = 7
/** Own-history baseline needs at least this many days with impressions (after the honeymoon cut). */
export const RULE_MIN_BASELINE_ACTIVE_DAYS = 5
/** Expected successes in the recent window at the baseline rate must reach this, otherwise the sample is too thin. */
export const RULE_MIN_EXPECTED = 5
/** At least this many recent days must individually sit below the baseline rate (real daily noise is ~2x binomial). */
export const RULE_MIN_PERSISTENT_DAYS = 2
/** Benjamini–Hochberg false discovery rate across one account's D2/D10 candidates of the day. */
export const RULE_BH_Q = 0.05
/** Recent spend must be at least this share of its ad set's recent spend (starved ads are not worth a PM's time). */
export const RULE_MIN_SHARE_OF_ADSET_SPEND = 0.1
export const D10_MIN_BASE_RESULTS = 20
export const D10_MIN_BASE_LINK_CLICKS = 30
export const D10_MIN_CVR_DROP = 0.4
/** D10 only fires when recent cost per result is at least this multiple of the baseline (a cheap ad with low CVR is not broken). */
export const D10_MIN_COST_MULTIPLE = 1.5
/** "Looks expensive but sample too thin" note only when recent cost per result >= this multiple of baseline. */
export const SAMPLE_NOTE_COST_MULTIPLE = 2

/** One day of one ad, already normalised. `results` null = not countable for this day (caller drops such days before summing). */
export interface FunnelDay {
  date: string            // YYYY-MM-DD
  spend: number
  impressions: number
  clicks: number          // Meta all-clicks
  linkClicks: number
  results: number | null
}

export interface FunnelTotals {
  days: number            // number of input days
  activeDays: number      // days with impressions > 0
  spend: number           // rounded to 2 decimals
  impressions: number
  clicks: number
  linkClicks: number
  results: number         // null results count as 0 here
}

/** Round to 2 decimals, guarding against non-finite input. */
function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

export function sumDays(days: readonly FunnelDay[]): FunnelTotals {
  let activeDays = 0
  let spend = 0
  let impressions = 0
  let clicks = 0
  let linkClicks = 0
  let results = 0
  for (const day of days) {
    if (day.impressions > 0) activeDays++
    spend += day.spend
    impressions += day.impressions
    clicks += day.clicks
    linkClicks += day.linkClicks
    results += day.results ?? 0
  }
  return {
    days: days.length,
    activeDays,
    spend: round2(spend),
    impressions,
    clicks,
    linkClicks,
    results,
  }
}

/** spend / results; null when results <= 0. Rounded to 2 decimals. */
export function costPerResult(t: FunnelTotals): number | null {
  if (t.results <= 0) return null
  return round2(t.spend / t.results)
}

export interface StepInput {
  recentSuccess: number
  recentTrials: number
  baseSuccess: number
  baseTrials: number
  /** per recent day: successes and trials of THIS step (e.g. clicks & impressions for CTR) */
  recentDaily: ReadonlyArray<{ success: number; trials: number }>
  minRelativeDrop: number
}

export type StepReason = 'ok' | 'no_baseline' | 'thin' | 'no_drop' | 'not_persistent'

export interface StepVerdict {
  reason: StepReason
  baseRate: number        // 0 when no baseline
  recentRate: number
  relativeDrop: number    // 1 - recentRate / baseRate; 0 when baseRate is 0
  expected: number        // recentTrials * baseRate
  persistentDays: number  // recent days with trials > 0 whose own rate < baseRate
  p: number               // one-sided Fisher lower tail; 1 unless reason === 'ok'
}

/** Clamp a success count into [0, trials], tolerating non-finite input. */
function clampSuccess(success: number, trials: number): number {
  if (!Number.isFinite(success)) return 0
  if (success < 0) return 0
  return success > trials ? trials : success
}

/** Count recent days whose own rate sits strictly below the baseline rate. */
function countPersistentDays(
  recentDaily: ReadonlyArray<{ success: number; trials: number }>,
  baseRate: number,
): number {
  let persistent = 0
  for (const day of recentDaily) {
    if (day.trials <= 0) continue
    const success = clampSuccess(day.success, day.trials)
    if (success / day.trials < baseRate) persistent++
  }
  return persistent
}

/**
 * Judge one funnel step, in this order:
 *  - clamp successes to trials on both sides (results can exceed link clicks in real data, e.g. 2 conversations from 1 link click)
 *  - baseTrials <= 0 or baseRate <= 0 → 'no_baseline'
 *  - recentRate >= baseRate → 'no_drop'  (covers recentSuccess >= recentTrials)
 *  - expected < RULE_MIN_EXPECTED → 'thin'
 *  - relativeDrop < minRelativeDrop → 'no_drop'
 *  - persistentDays < RULE_MIN_PERSISTENT_DAYS → 'not_persistent'
 *  - otherwise 'ok' with p = fisherLowerTailP(recentSuccess, recentTrials, baseSuccess, baseTrials)
 * For a single recent day, clamp its success to its trials before comparing with baseRate.
 * Rates are plain fractions (not percent). Do not round rates inside this function.
 */
export function judgeStep(input: StepInput): StepVerdict {
  const recentTrials = input.recentTrials > 0 ? input.recentTrials : 0
  const baseTrials = input.baseTrials > 0 ? input.baseTrials : 0
  const recentSuccess = clampSuccess(input.recentSuccess, recentTrials)
  const baseSuccess = clampSuccess(input.baseSuccess, baseTrials)

  const baseRate = baseTrials > 0 ? baseSuccess / baseTrials : 0
  const recentRate = recentTrials > 0 ? recentSuccess / recentTrials : 0
  const relativeDrop = baseRate > 0 ? 1 - recentRate / baseRate : 0
  const expected = recentTrials * baseRate
  const persistentDays = baseRate > 0 ? countPersistentDays(input.recentDaily, baseRate) : 0

  const base: Omit<StepVerdict, 'reason' | 'p'> = {
    baseRate,
    recentRate,
    relativeDrop,
    expected,
    persistentDays,
  }

  if (baseTrials <= 0 || baseRate <= 0) {
    return { ...base, reason: 'no_baseline', p: 1 }
  }
  if (recentRate >= baseRate) {
    return { ...base, reason: 'no_drop', p: 1 }
  }
  if (expected < RULE_MIN_EXPECTED) {
    return { ...base, reason: 'thin', p: 1 }
  }
  if (relativeDrop < input.minRelativeDrop) {
    return { ...base, reason: 'no_drop', p: 1 }
  }
  if (persistentDays < RULE_MIN_PERSISTENT_DAYS) {
    return { ...base, reason: 'not_persistent', p: 1 }
  }
  const p = fisherLowerTailP(recentSuccess, recentTrials, baseSuccess, baseTrials)
  return { ...base, reason: 'ok', p }
}
