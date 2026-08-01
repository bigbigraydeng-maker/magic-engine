/**
 * Hand 1 — Ad delivery watcher.
 *
 * Catches three distinct ways paid delivery fails, all of which have really
 * happened and none of which the legacy metric-threshold engine can see:
 *
 *   A. ad-spend-no-result   money went out, nothing came back
 *   B. ad-spend-collapse    a campaign quietly throttled itself
 *   C. ad-delivery-dark     a proven producer stopped entirely
 *
 * Rule C is the one that would have caught CTS "Lead Form — Reborn": it stopped
 * on 2026-07-20 after 27 days and 203 leads, and crucially it stopped WRITING
 * ROWS rather than writing zero rows. Detection has to be about absence.
 *
 * All functions here are pure — I/O lives in the job. That keeps the thresholds
 * directly testable, which matters because thresholds are the whole product.
 */

import type { AdEntityHistory, AdDeliveryDay, WatchSignal } from './types'
import { classifyDisposition, type RemedyProfile } from '../disposition'

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Ignore trivial spend so we do not page anyone over $3. */
export const MIN_DAILY_SPEND_AUD = 20
/** Rule B fires below this share of the campaign's own 7-day average. */
export const SPEND_COLLAPSE_DROP_PCT = 60
/** Rule C fires after this many consecutive days with no spend. */
export const DARK_DAYS_THRESHOLD = 3
/** Window used to decide whether a campaign was a "steady producer". */
export const PRODUCER_LOOKBACK_DAYS = 14
/** Days with results>0 needed inside that window to count as steady. */
export const PRODUCER_MIN_RESULT_DAYS = 3

/**
 * How stale the newest row may be and still be judged as "the current day".
 *
 * Meta's insights lag roughly a day. Beyond that, a campaign with no fresh rows
 * is not delivering badly — it has stopped, which is rule C's job. Without this
 * guard rules A and B re-fire on the same frozen row every single day of a
 * blackout, which is precisely how an alert channel becomes wallpaper.
 */
export const AD_DATA_LAG_DAYS = 2

/**
 * Calendar span the rule-B baseline is drawn from, and the minimum number of
 * days that must actually be present inside it.
 *
 * Taking "the previous 7 rows" instead of "rows in the previous 7 days" was a
 * real bug: after CTS resumed on 2026-07-28, the 7 preceding ROWS reached back
 * across the blackout to 2026-07-17, mixing $85/day pre-stop days with $37/day
 * restart days. That inflated the baseline enough to report a 65% collapse on a
 * campaign that was simply running at its new, lower budget.
 */
export const BASELINE_WINDOW_DAYS = 7
export const BASELINE_MIN_DAYS = 5

// ── Date helpers (UTC-safe, date-only) ────────────────────────────────────────

export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${toDate.slice(0, 10)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Shared remedy profiles ────────────────────────────────────────────────────

/** Re-starting or re-budgeting a campaign puts money back in the auction. */
const REMEDY_RESTART_CAMPAIGN: RemedyProfile = {
  spendsMoney: true,
  customerFacing: true,
  hardToReverse: false,
}

/** Pausing a live campaign is still visible outward and changes delivery. */
const REMEDY_PAUSE_CAMPAIGN: RemedyProfile = {
  spendsMoney: true,
  customerFacing: true,
  hardToReverse: false,
}

// ── Rule A: spend with zero results ───────────────────────────────────────────

/** Is the newest row we hold recent enough to be judged as "the current day"? */
function hasCurrentData(history: AdEntityHistory, today: string): boolean {
  const days = history.days
  if (days.length === 0) return false
  const lag = daysBetween(days[days.length - 1].insightDate, today)
  return lag >= 0 && lag <= AD_DATA_LAG_DAYS
}

/**
 * Money went out on the most recent day and produced nothing, for a campaign
 * that normally produces. Fires on the day the failure starts, which is the
 * earliest any system could know.
 */
export function detectSpendNoResult(
  history: AdEntityHistory,
  today: string
): Omit<WatchSignal, 'clientId' | 'clientName'> | null {
  const days = history.days
  // Stale data means "stopped", not "performing badly" — rule C owns that.
  if (!hasCurrentData(history, today)) return null

  const latest = days[days.length - 1]
  if (latest.spend < MIN_DAILY_SPEND_AUD) return null
  if (latest.results > 0) return null

  // Must have a track record, else "zero results" is just a cold new campaign.
  const prior = days.slice(0, -1).slice(-7)
  const priorResults = prior.reduce((s, d) => s + d.results, 0)
  if (priorResults === 0) return null

  const priorResultPerDay = mean(prior.map(d => d.results))
  const verdict = classifyDisposition(REMEDY_PAUSE_CAMPAIGN)

  return {
    watcherId: 'ad-delivery',
    ruleId: 'ad-spend-no-result',
    flywheel: 'ads',
    severity: latest.spend >= MIN_DAILY_SPEND_AUD * 2 ? 'high' : 'medium',
    entityId: history.entityId,
    entityName: history.entityName,
    whatChanged:
      `"${history.entityName}" spent $${round2(latest.spend)} on ${latest.insightDate} ` +
      `and returned 0 results. It averaged ${priorResultPerDay.toFixed(1)} results/day ` +
      `over the previous ${prior.length} days.`,
    moneyImpactAud: round2(latest.spend),
    moneyBasis: `Recorded spend on ${latest.insightDate} that returned zero results.`,
    daysOngoing: 1,
    disposition: verdict.disposition,
    dispositionReason: verdict.reason,
    remedy: REMEDY_PAUSE_CAMPAIGN,
    observedThrough: latest.insightDate,
  }
}

// ── Rule B: spend collapse vs own baseline ────────────────────────────────────

/**
 * The campaign is still alive but delivering far below its own recent normal —
 * usually budget exhaustion, audience saturation, or a rejected creative.
 */
export function detectSpendCollapse(
  history: AdEntityHistory,
  today: string
): Omit<WatchSignal, 'clientId' | 'clientName'> | null {
  const days = history.days
  if (!hasCurrentData(history, today)) return null

  const latest = days[days.length - 1]
  // A full stop is rule C's job; this rule is about partial collapse.
  if (latest.spend <= 0) return null

  // Baseline = rows inside the preceding CALENDAR window, not the preceding N
  // rows. A window spanning a blackout is not an average of anything.
  const baselineDays = days.slice(0, -1).filter(d => {
    const age = daysBetween(d.insightDate, latest.insightDate)
    return age >= 1 && age <= BASELINE_WINDOW_DAYS
  })
  if (baselineDays.length < BASELINE_MIN_DAYS) return null

  const baseline = mean(baselineDays.map(d => d.spend))
  if (baseline < MIN_DAILY_SPEND_AUD) return null

  const dropPct = ((baseline - latest.spend) / baseline) * 100
  if (dropPct <= SPEND_COLLAPSE_DROP_PCT) return null

  const verdict = classifyDisposition(REMEDY_RESTART_CAMPAIGN)

  return {
    watcherId: 'ad-delivery',
    ruleId: 'ad-spend-collapse',
    flywheel: 'ads',
    severity: 'high',
    entityId: history.entityId,
    entityName: history.entityName,
    whatChanged:
      `"${history.entityName}" spent $${round2(latest.spend)} on ${latest.insightDate}, ` +
      `down ${dropPct.toFixed(0)}% from its own ${BASELINE_WINDOW_DAYS}-day average of ` +
      `$${round2(baseline)}/day.`,
    moneyImpactAud: round2(baseline - latest.spend),
    moneyBasis:
      `Budget that did not deploy on ${latest.insightDate}: ` +
      `${BASELINE_WINDOW_DAYS}-day average $${round2(baseline)} ` +
      `(from ${baselineDays.length} days with data) minus actual $${round2(latest.spend)}.`,
    daysOngoing: 1,
    disposition: verdict.disposition,
    dispositionReason: verdict.reason,
    remedy: REMEDY_RESTART_CAMPAIGN,
    observedThrough: latest.insightDate,
  }
}

// ── Rule C: proven producer went dark ─────────────────────────────────────────

/** Was this campaign reliably producing before it stopped? */
export function wasSteadyProducer(days: AdDeliveryDay[], lastSpendDate: string): boolean {
  const window = days.filter(
    d =>
      daysBetween(d.insightDate, lastSpendDate) >= 0 &&
      daysBetween(d.insightDate, lastSpendDate) < PRODUCER_LOOKBACK_DAYS
  )
  const resultDays = window.filter(d => d.results > 0).length
  return resultDays >= PRODUCER_MIN_RESULT_DAYS
}

/**
 * A campaign that used to produce has spent nothing for N+ days.
 *
 * Note this deliberately works off the LAST DAY WITH SPEND rather than the last
 * row, because a stopped campaign usually stops emitting rows altogether.
 */
export function detectDeliveryDark(
  history: AdEntityHistory,
  today: string
): Omit<WatchSignal, 'clientId' | 'clientName'> | null {
  const days = history.days
  if (days.length === 0) return null

  const spendingDays = days.filter(d => d.spend > 0)
  if (spendingDays.length === 0) return null

  // Measured against the RUN DATE, not the newest row. Anchoring to the newest
  // row makes this arithmetic collapse to zero during exactly the blackout it
  // is supposed to detect: the newest row IS the last day it spent.
  const lastSpend = spendingDays[spendingDays.length - 1]
  const darkDays = daysBetween(lastSpend.insightDate, today)
  if (darkDays < DARK_DAYS_THRESHOLD) return null

  if (!wasSteadyProducer(days, lastSpend.insightDate)) return null

  // Baseline from the last 7 days it actually spent.
  const recentSpending = spendingDays.slice(-7)
  const avgDailySpend = mean(recentSpending.map(d => d.spend))
  const avgDailyResults = mean(recentSpending.map(d => d.results))
  const lifetimeResults = days.reduce((s, d) => s + d.results, 0)

  const verdict = classifyDisposition(REMEDY_RESTART_CAMPAIGN)

  return {
    watcherId: 'ad-delivery',
    ruleId: 'ad-delivery-dark',
    flywheel: 'ads',
    severity: darkDays >= 5 ? 'high' : 'medium',
    entityId: history.entityId,
    entityName: history.entityName,
    whatChanged:
      `"${history.entityName}" has spent nothing since ${lastSpend.insightDate} ` +
      `(${darkDays} days). Before stopping it ran at $${round2(avgDailySpend)}/day ` +
      `and ${avgDailyResults.toFixed(1)} results/day, ${lifetimeResults} results lifetime. ` +
      `Roughly ${Math.round(avgDailyResults * darkDays)} results forgone so far.`,
    moneyImpactAud: round2(avgDailySpend * darkDays),
    moneyBasis:
      `Budget that stopped deploying: $${round2(avgDailySpend)}/day ` +
      `(average of its last ${recentSpending.length} spending days) x ${darkDays} dark days. ` +
      `This is forgone deployment, not cash lost.`,
    daysOngoing: darkDays,
    disposition: verdict.disposition,
    dispositionReason: verdict.reason,
    remedy: REMEDY_RESTART_CAMPAIGN,
    observedThrough: days[days.length - 1].insightDate,
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Run all three ad rules over one campaign's history.
 *
 * `today` is the run date. Each rule decides for itself how to relate that to
 * the data it holds: A and B refuse to judge stale rows, C measures the gap
 * between the last spending day and now.
 */
export function inspectAdEntity(
  history: AdEntityHistory,
  today: string
): Omit<WatchSignal, 'clientId' | 'clientName'>[] {
  const out: Omit<WatchSignal, 'clientId' | 'clientName'>[] = []
  for (const detect of [detectSpendNoResult, detectSpendCollapse, detectDeliveryDark]) {
    const signal = detect(history, today)
    if (signal) out.push(signal)
  }
  return out
}
