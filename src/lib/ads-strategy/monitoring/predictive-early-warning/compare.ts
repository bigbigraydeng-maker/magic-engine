/**
 * Intraday-style early warning: today's cost per primary result vs trailing 7 complete days.
 * Pure functions only — callers supply spend/results from existing tables.
 */

import type { CostMetric } from '@/lib/ads-strategy/portfolio/goal-context'
import {
  OVER_AVG_NUM,
  OVER_AVG_DEN,
  WORSEN_RE_ALERT_DEN,
  WORSEN_RE_ALERT_NUM,
} from './switch'

export interface EntityDayTotals {
  spendMajor: number
  resultCount: number
}

export interface EntityEvalInput {
  entityId: string
  level: 'adset' | 'campaign'
  metric: CostMetric
  today: EntityDayTotals
  /** Up to 7 complete days before today; missing days are OK. */
  baselineDays: readonly EntityDayTotals[]
  minSpendMajor: number
  /** NZ account day for idempotency (caller-managed). */
  accountDay: string
  priorAlertCprMajor: number | null
}

export type EarlyWarningSkip =
  | 'below_spend_floor'
  | 'no_baseline'
  | 'not_over_threshold'
  | 'already_alerted_stable'

export type EarlyWarningVerdict =
  | { alert: false; skip: EarlyWarningSkip }
  | {
      alert: true
      todayCprMajor: number | null
      baselineCprMajor: number
      baselineDayCount: number
      overRatio: number
      zeroResults: boolean
    }

export function costPerResultMajor(spendMajor: number, results: number): number | null {
  if (!Number.isFinite(spendMajor) || spendMajor < 0) return null
  if (results <= 0) return null
  return round2(spendMajor / results)
}

/** Daily CPL samples: only days with spend>0 and results>0 count toward the average. */
export function averageBaselineCpr(days: readonly EntityDayTotals[]): { avg: number | null; usedDays: number } {
  const cprs: number[] = []
  for (const day of days) {
    const c = costPerResultMajor(day.spendMajor, day.resultCount)
    if (c !== null) cprs.push(c)
  }
  if (cprs.length === 0) return { avg: null, usedDays: 0 }
  const sum = cprs.reduce((a, b) => a + b, 0)
  return { avg: round2(sum / cprs.length), usedDays: cprs.length }
}

export function isOverThreshold(
  todayCpr: number | null,
  baselineCpr: number,
  zeroResultsWithSpend: boolean,
): boolean {
  if (baselineCpr <= 0) return false
  if (zeroResultsWithSpend) return true
  if (todayCpr === null) return false
  const left = todayCpr * OVER_AVG_DEN
  const right = baselineCpr * OVER_AVG_NUM
  return left > right
}

export function shouldReAlert(todayCpr: number | null, priorCpr: number | null, zeroResults: boolean): boolean {
  if (priorCpr === null) return true
  if (zeroResults) return true
  if (todayCpr === null) return false
  const left = todayCpr * WORSEN_RE_ALERT_DEN
  const right = priorCpr * WORSEN_RE_ALERT_NUM
  return left > right
}

export function evaluateEntityEarlyWarning(input: EntityEvalInput): EarlyWarningVerdict {
  if (input.today.spendMajor < input.minSpendMajor) {
    return { alert: false, skip: 'below_spend_floor' }
  }
  const { avg, usedDays } = averageBaselineCpr(input.baselineDays)
  if (avg === null || usedDays === 0) {
    return { alert: false, skip: 'no_baseline' }
  }
  const zeroResults = input.today.resultCount <= 0
  const todayCpr = zeroResults ? null : costPerResultMajor(input.today.spendMajor, input.today.resultCount)
  if (!isOverThreshold(todayCpr, avg, zeroResults)) {
    return { alert: false, skip: 'not_over_threshold' }
  }
  if (input.priorAlertCprMajor !== null && !shouldReAlert(todayCpr, input.priorAlertCprMajor, zeroResults)) {
    return { alert: false, skip: 'already_alerted_stable' }
  }
  const overRatio = zeroResults ? Infinity : round2((todayCpr as number) / avg)
  return {
    alert: true,
    todayCprMajor: todayCpr,
    baselineCprMajor: avg,
    baselineDayCount: usedDays,
    overRatio,
    zeroResults,
  }
}

export function metricLabel(metric: CostMetric): string {
  if (metric === 'leads') return '单次留资成本'
  if (metric === 'messaging') return '单次私信对话成本'
  return '单次成效成本'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}