/**
 * SEO Meta-Cycle v1 — Check step (step 1: re-classify last cycle's changes
 * at T+7/T+14) outcome classifier.
 *
 * 魏征 finding #4: seo/post-publish-monitor.ts's `classifyReceipt` judges
 * page crawl/index HEALTH (is the page reachable, indexable, has fresh GSC
 * data) — it does NOT compare before-vs-after CTR/position. Do not reuse its
 * judgment logic. This is a new classifier for meta-change effectiveness.
 *
 * 魏征 finding #11: the classifier MUST enforce a minimum absolute sample
 * size (impressions/clicks) before calling anything improved/regressed.
 * post-publish-monitor's classifyReceipt is a freshness-only check (is the
 * GSC snapshot recent enough), which would misclassify low-traffic long-tail
 * pages constantly — a page with 3 impressions before and 1 after looks like
 * a -66% CTR "regression" that is actually just noise. Below the floor this
 * MUST return insufficient_data, and callers MUST NOT auto-revert on it.
 */

import type { MetaCycleBaseline, MetaCycleObserved, MetaCycleOutcome } from './types'

/** Below this many impressions in EITHER window, the CTR delta is noise, not signal. */
export const MIN_IMPRESSIONS_FOR_CLASSIFICATION = 30

/** ±this many percentage points of CTR is "flat" — avoids flagging measurement jitter as a real move. */
const FLAT_BAND_PCT = 1.0

export interface OutcomeClassification {
  outcome: MetaCycleOutcome
  ctrDeltaPct: number | null
  reason: string
}

function ctrOf(impressions: number | null, clicks: number | null): number | null {
  if (impressions === null || impressions <= 0 || clicks === null) return null
  return (clicks / impressions) * 100
}

/**
 * Pure — no I/O. `baseline` is what was recorded at apply-time
 * (seo_meta_log.baseline_*); `observed` is the fresh GSC pull at the T+7/T+14
 * checkpoint.
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
      ctrDeltaPct: null,
      reason: `impressions below the ${MIN_IMPRESSIONS_FOR_CLASSIFICATION} floor (baseline=${baselineImpressions}, observed=${observedImpressions}) — not enough sample to call improved/regressed`,
    }
  }

  const baselineCtr = baseline.ctr ?? ctrOf(baseline.impressions, null)
  const observedCtr = observed.ctr ?? ctrOf(observed.impressions, observed.clicks)

  if (baselineCtr === null || observedCtr === null) {
    return {
      outcome: 'insufficient_data',
      ctrDeltaPct: null,
      reason: 'CTR could not be computed for one of the two windows (missing clicks or CTR data)',
    }
  }

  const deltaPct = observedCtr - baselineCtr

  if (Math.abs(deltaPct) <= FLAT_BAND_PCT) {
    return { outcome: 'flat', ctrDeltaPct: deltaPct, reason: `CTR moved ${deltaPct.toFixed(2)}pp, within the ±${FLAT_BAND_PCT}pp flat band` }
  }
  if (deltaPct > 0) {
    return { outcome: 'improved', ctrDeltaPct: deltaPct, reason: `CTR improved ${deltaPct.toFixed(2)}pp (${baselineCtr.toFixed(2)}% → ${observedCtr.toFixed(2)}%) with ${observedImpressions} observed impressions` }
  }
  return { outcome: 'regressed', ctrDeltaPct: deltaPct, reason: `CTR dropped ${Math.abs(deltaPct).toFixed(2)}pp (${baselineCtr.toFixed(2)}% → ${observedCtr.toFixed(2)}%) with ${observedImpressions} observed impressions` }
}
