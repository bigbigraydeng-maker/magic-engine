/**
 * Expected-impact estimator (Phase 22.E.S9).
 *
 * Computes a 90-day "uplift if FDE does this action" number that the action
 * card can show, so the FDE knows what value each task is supposed to
 * generate. Pure function, no AI, no I/O — runs in the browser when the
 * Content Workbench opens.
 *
 * Coverage (intentionally narrow):
 *   - SEO actions whose metadata carries a measurable signal — the
 *     keyword+volume from a patrol finding, or the keyword from an FDE-typed
 *     landing-page action.
 *   - Strategic / workflow actions ("Configure Target Keywords",
 *     "Publish Blog Post") have no keyword dimension and return null. The
 *     caller MUST hide the card when this returns null — do not show
 *     "estimate unavailable".
 *
 * CTR benchmark by position (mirrors `rules.ts::ctrBenchmarkForPosition`):
 *
 *   position 1     → 0.28
 *   position 2     → 0.15
 *   position 3     → 0.11
 *   position 4–5   → 0.07
 *   position 6–10  → 0.035
 *   position 11–20 → 0.012
 *   position 21–50 → 0.004   ← what `ctrBenchmarkForPosition(30)` returns
 *   position 51+   → 0.001
 *
 * Decay factors picked to be deliberately conservative:
 *   - new content lands at ~position 30 in 90 days, half the time at position 50
 *     for landing pages (slower than blog posts).
 *   - factor 0.5 means "we believe half the modelled uplift after 90 days"
 *     and keeps the FDE honest about what one piece of content can do.
 */

import { ctrBenchmarkForPosition } from './rules'

/** Result returned to the UI. null = do not render the impact card. */
export interface ExpectedImpact {
  /** Estimated clicks per month, rounded for display. */
  clicks_per_month: number
  /** One-line explanation of the calculation, shown under the headline. */
  basis: string
}

/**
 * Compute expected impact for a SEO execution_item.
 *
 * `metadata` is the `steps_json` value as received from the API. It may be
 * null, an arbitrary record, or a record missing the fields we need; the
 * function treats every input defensively and returns null when it cannot
 * produce a meaningful estimate.
 */
export function computeExpectedImpact(
  metadata: unknown,
): ExpectedImpact | null {
  if (!metadata || typeof metadata !== 'object') return null
  const m = metadata as Record<string, unknown>

  const ruleId = typeof m.rule_id === 'string' ? m.rule_id : null
  const searchVolume = numOrNull(m.search_volume)

  switch (ruleId) {
    case 'keyword_opportunity':
      return opportunityImpact(searchVolume)

    case 'phase1_landing_page':
      return landingPageImpact(searchVolume)

    case 'stale_content':
      return staleContentImpact(
        searchVolume,
        numOrNull(m.prior_position),
        numOrNull(m.position),
      )

    case 'low_ctr_title':
      return lowCtrImpact(
        numOrNull(m.impressions),
        numOrNull(m.ctr),
        numOrNull(m.ctr_benchmark),
      )

    default:
      return null
  }
}

// ── Branches ────────────────────────────────────────────────────────────────

/**
 * Opportunity keyword: assume the page will reach position ~30 within 90 days
 * (the "new content cold start" position). At position 30 the benchmark CTR
 * is 0.004; we discount by 0.5 to stay conservative about whether the article
 * fully ranks in 90 days.
 */
function opportunityImpact(volume: number | null): ExpectedImpact | null {
  if (volume === null || volume <= 0) return null
  const ctrAt30 = ctrBenchmarkForPosition(30)  // 0.004
  const clicks = volume * ctrAt30 * 0.5
  if (clicks <= 0) return null
  return {
    clicks_per_month: clicks,
    basis: `搜索量 ${volume}/月 × 第 30 位基准 CTR ${pct(ctrAt30)} × 保守系数 0.5（假设 90 天进入第 30 位）`,
  }
}

/**
 * Landing page for a high-volume head term: slower to rank than a blog post —
 * assume position ~50 in 90 days, same 0.5 conservatism.
 */
function landingPageImpact(volume: number | null): ExpectedImpact | null {
  if (volume === null || volume <= 0) return null
  const ctrAt50 = ctrBenchmarkForPosition(50)  // 0.004
  const clicks = volume * ctrAt50 * 0.5
  if (clicks <= 0) return null
  return {
    clicks_per_month: clicks,
    basis: `搜索量 ${volume}/月 × 第 50 位基准 CTR ${pct(ctrAt50)} × 保守系数 0.5（落地页 90 天保守进入第 50 位）`,
  }
}

/**
 * Stale content that slipped: estimate the clicks we'd recover by climbing
 * back from the current position to the prior one. No discount factor — the
 * delta is already conservative because CTRs are bucketed.
 */
function staleContentImpact(
  volume: number | null,
  priorPosition: number | null,
  currentPosition: number | null,
): ExpectedImpact | null {
  if (volume === null || volume <= 0) return null
  if (priorPosition === null || currentPosition === null) return null
  if (priorPosition <= 0 || currentPosition <= 0) return null
  if (currentPosition <= priorPosition) return null  // no slip, nothing to recover

  const priorCtr = ctrBenchmarkForPosition(priorPosition)
  const currentCtr = ctrBenchmarkForPosition(currentPosition)
  const delta = priorCtr - currentCtr
  if (delta <= 0) return null

  const clicks = volume * delta
  if (clicks <= 0) return null
  return {
    clicks_per_month: clicks,
    basis: `搜索量 ${volume}/月 × (第 ${priorPosition} 位 CTR ${pct(priorCtr)} − 当前第 ${currentPosition} 位 CTR ${pct(currentCtr)})`,
  }
}

/**
 * Low CTR title rewrite: the lift is what we recover by closing the gap
 * between actual CTR (poor) and benchmark CTR (what this position should
 * yield). Stays linear because impressions are already the constraint.
 */
function lowCtrImpact(
  impressions: number | null,
  actualCtr: number | null,
  benchmarkCtr: number | null,
): ExpectedImpact | null {
  if (impressions === null || impressions <= 0) return null
  if (actualCtr === null || benchmarkCtr === null) return null
  if (benchmarkCtr <= actualCtr) return null  // already at or above benchmark

  const lift = benchmarkCtr - actualCtr
  const clicks = impressions * lift
  if (clicks <= 0) return null
  return {
    clicks_per_month: clicks,
    basis: `曝光 ${impressions}/月 × (基准 CTR ${pct(benchmarkCtr)} − 当前 CTR ${pct(actualCtr)})`,
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}
