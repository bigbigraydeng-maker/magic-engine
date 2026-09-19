/**
 * SEO Meta-Cycle v1 — Check step (step 1: re-classify last cycle's changes
 * at T+14) outcome classifier.
 *
 * 魏征 finding #4: seo/post-publish-monitor.ts's `classifyReceipt` judges
 * page crawl/index HEALTH (is the page reachable, indexable, has fresh GSC
 * data) — it does NOT compare before-vs-after CTR/position. Do not reuse its
 * judgment logic. This is a new classifier for meta-change effectiveness.
 *
 * 魏征 finding #11: the classifier MUST enforce a minimum absolute sample
 * size (impressions/clicks) before calling anything improved/regressed.
 * Below the floor this MUST return insufficient_data.
 *
 * PM 2026-09-20 精简拍板 (量纲 bug fix): GSC's real `ctr` field — both in
 * `gsc_performance_snapshots.top_pages` and everywhere else this codebase
 * reads it (e.g. post-publish-monitor-store.ts's readPageMetrics) — is a
 * 0-1 DECIMAL FRACTION, not a 0-100 percentage. The original version of
 * this classifier multiplied by 100 and used a "1.0" flat band meaning "1
 * percentage point" — against real GSC data that band was 100x too wide,
 * so it would have called almost everything "flat" no matter what actually
 * happened. Fixed to work in the real 0-1 scale throughout: FLAT_BAND is
 * 0.01 (i.e. ±1 percentage point, same real-world meaning, correct units).
 */

import type { MetaCycleBaseline, MetaCycleObserved, MetaCycleOutcome } from './types'

/** Below this many impressions in EITHER window, the CTR delta is noise, not signal. */
export const MIN_IMPRESSIONS_FOR_CLASSIFICATION = 30

/** ±this much CTR (0-1 decimal fraction — 0.01 = 1 percentage point) is "flat". */
const FLAT_BAND = 0.01

export interface OutcomeClassification {
  outcome: MetaCycleOutcome
  /** Decimal-fraction delta (observed - baseline), e.g. 0.014 = +1.4 percentage points. Not a "pp"-suffixed percentage. */
  ctrDelta: number | null
  reason: string
}

function ctrOf(impressions: number | null, clicks: number | null): number | null {
  if (impressions === null || impressions <= 0 || clicks === null) return null
  return clicks / impressions
}

function pct(decimalCtr: number): string {
  return `${(decimalCtr * 100).toFixed(2)}%`
}

/**
 * Pure — no I/O. `baseline` is what was recorded at apply-time
 * (seo_meta_log.baseline_*); `observed` is the fresh GSC pull at the T+14
 * checkpoint. Both ctr fields are 0-1 decimal fractions.
 */
export function classifyMetaChangeOutcome(
  baseline: MetaCycleBaseline,
  observed: MetaCycleObserved,
): OutcomeClassification {
  const baselineImpressions = baseline.impressions ?? 0
  const observedImpressions = observed.impressions ?? 0

  if (baselineImpressions < MIN_IMPRESSIONS_FOR_CLASSIFICATION || observedImpressions < MIN_IMPRESSIONS_FOR_CLASSIFICATION) {
    return {
      outcome: 'insufficient_data',
      ctrDelta: null,
      reason: `impressions below the ${MIN_IMPRESSIONS_FOR_CLASSIFICATION} floor (baseline=${baselineImpressions}, observed=${observedImpressions}) — not enough sample to call improved/regressed`,
    }
  }

  // baseline never carries clicks (seo_meta_log has no baseline_clicks
  // column, only baseline_ctr captured directly from the GSC snapshot at
  // apply time) — there is no derivation to fall back to.
  const baselineCtr = baseline.ctr
  const observedCtr = observed.ctr ?? ctrOf(observed.impressions, observed.clicks)

  if (baselineCtr === null || observedCtr === null) {
    return {
      outcome: 'insufficient_data',
      ctrDelta: null,
      reason: 'CTR could not be computed for one of the two windows (missing clicks or CTR data)',
    }
  }

  const delta = observedCtr - baselineCtr

  if (Math.abs(delta) <= FLAT_BAND) {
    return { outcome: 'flat', ctrDelta: delta, reason: `CTR moved ${pct(delta)}, within the ±${pct(FLAT_BAND)} flat band` }
  }
  if (delta > 0) {
    return { outcome: 'improved', ctrDelta: delta, reason: `CTR improved from ${pct(baselineCtr)} to ${pct(observedCtr)} with ${observedImpressions} observed impressions` }
  }
  return { outcome: 'regressed', ctrDelta: delta, reason: `CTR dropped from ${pct(baselineCtr)} to ${pct(observedCtr)} with ${observedImpressions} observed impressions` }
}
