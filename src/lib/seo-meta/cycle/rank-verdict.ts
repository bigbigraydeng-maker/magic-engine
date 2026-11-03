/**
 * SEO Meta-Cycle — rank verdict state machine (2026-10-04 rank-verification redesign).
 *
 * Pure: no I/O. Turns "baseline rank at apply time" + "up to 3 later SERP samples"
 * into one of the verdicts allowed by seo_meta_log.rank_verdict's CHECK.
 *
 * READ THIS BEFORE CHANGING A THRESHOLD OR A WORD:
 *
 * `no_detectable_change` means "this ruler saw no move". It does NOT mean "the
 * title change had no effect". A title acts mainly through click-through rate, and
 * at CTS's traffic CTR is too noisy to judge (placebo: 41% false "effects"), so
 * rank staying put is the EXPECTED outcome of most title edits. The verdict names
 * deliberately avoid improved/regressed/effective so nothing downstream can read
 * them as a causal verdict. A rank move also shows what happened, not that the
 * title caused it (competitors, algorithm updates, the client's own other edits).
 *
 * Statuses that are NOT measurements are kept apart from "measured, nothing moved":
 *   not_measured   — we could not / should not judge (reason in detail)
 *   unstable       — the page flipped between ranked and not-ranked across samples
 *   (never collapse either into no_detectable_change)
 */

import type { RankStatus } from './rank-check'

/** First sample is taken this many days after the change (gives Google time to recrawl and re-rank). */
export const FIRST_SAMPLE_AFTER_DAYS = 18
/** Valid samples required before any verdict other than not_measured is written. */
export const MIN_VALID_SAMPLES = 3
/** Hard stop: 3 required samples + up to 2 retries after fetch failures. */
export const MAX_SAMPLE_ATTEMPTS = 5
/** Samples are at least this many calendar days apart — adjacent days are not independent for low-volume keywords. */
export const SAMPLE_SPACING_DAYS = 2
/** Median rank must move at least this many places, in the same direction on every sample, to count as a move. */
export const MIN_RANK_MOVE = 3

export type RankVerdict =
  | 'not_measured'
  | 'no_detectable_change'
  | 'rank_moved_up'
  | 'rank_moved_down'
  | 'entered_top_n'
  | 'dropped_out'
  | 'unstable'
  | 'confounded'

export type NotMeasuredReason =
  | 'reverted'
  | 'superseded'
  | 'no_baseline'
  | 'baseline_other_own_page'
  | 'live_title_mismatch'
  | 'fetch_failed'
  | 'url_changed'
  | 'never_ranked'

/** One stored element of seo_meta_log.rank_samples. */
export interface StoredRankSample {
  day: string
  status: RankStatus
  rank_group: number | null
  url: string | null
  depth: number
  fetched_at: string
  cost: number | null
}

export interface StoredBaseline {
  status: RankStatus | null
  rank_group: number | null
  depth: number | null
}

export interface DecideInput {
  baseline: StoredBaseline
  samples: StoredRankSample[]
  /** seo_meta_log.reverted_at — the change did not stay live for the sampling window. */
  revertedAt: string | null
  /** A later change to the same page exists, so this row's window is contaminated. */
  supersededByLaterChange: boolean
  /** Does the live page <title> start with the title we wrote? null = could not check (does not block). */
  liveTitleOk: boolean | null
}

export interface VerdictDetail {
  reason: NotMeasuredReason | null
  valid_samples: number
  attempts: number
  baseline_rank: number | null
  sample_ranks: Array<number | null>
  /** Median of (sample rank − baseline rank). Positive = worse (a larger rank number). */
  median_delta: number | null
}

export type VerdictResult =
  | { kind: 'pending'; valid_samples: number; attempts: number }
  | { kind: 'final'; verdict: RankVerdict; detail: VerdictDetail }

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

function final(verdict: RankVerdict, detail: Partial<VerdictDetail> & Pick<VerdictDetail, 'valid_samples' | 'attempts'>, baseline: StoredBaseline, samples: StoredRankSample[]): VerdictResult {
  return {
    kind: 'final',
    verdict,
    detail: {
      reason: null,
      baseline_rank: baseline.rank_group,
      sample_ranks: samples.map((s) => s.rank_group),
      median_delta: null,
      ...detail,
    },
  }
}

function pre(reason: NotMeasuredReason, baseline: StoredBaseline, samples: StoredRankSample[]): VerdictResult {
  return final('not_measured', { reason, valid_samples: 0, attempts: samples.length }, baseline, samples)
}

/** Everything that makes a row unjudgeable no matter what the samples say. */
function blockedBeforeSampling(input: DecideInput): NotMeasuredReason | null {
  const { baseline } = input
  if (input.revertedAt !== null) return 'reverted'
  if (input.supersededByLaterChange) return 'superseded'
  if (baseline.status === null || baseline.status === 'fetch_failed' || baseline.depth === null) return 'no_baseline'
  // A 'ranked' baseline without a rank is an inconsistent row — never guess a number for it.
  if (baseline.status === 'ranked' && baseline.rank_group === null) return 'no_baseline'
  if (baseline.status === 'other_own_page') return 'baseline_other_own_page'
  if (input.liveTitleOk === false) return 'live_title_mismatch'
  return null
}

function compareToBaseline(baselineRank: number, sampleRanks: number[], baseline: StoredBaseline, used: StoredRankSample[], counts: { valid_samples: number; attempts: number }): VerdictResult {
  const deltas = sampleRanks.map((r) => r - baselineRank)
  const med = median(deltas)
  const sameDirection = deltas.every((d) => d > 0) || deltas.every((d) => d < 0)
  const moved = sameDirection && Math.abs(med) >= MIN_RANK_MOVE
  const verdict: RankVerdict = !moved ? 'no_detectable_change' : med < 0 ? 'rank_moved_up' : 'rank_moved_down'
  return final(verdict, { ...counts, median_delta: med }, baseline, used)
}

export function decideRankVerdict(input: DecideInput): VerdictResult {
  const { baseline, samples } = input
  const blocked = blockedBeforeSampling(input)
  if (blocked) return pre(blocked, baseline, samples)

  const usable = samples
    .filter((s) => s.status !== 'fetch_failed' && s.depth === baseline.depth)
    .sort((a, b) => a.day.localeCompare(b.day))
  const attempts = samples.length
  if (usable.length < MIN_VALID_SAMPLES) {
    if (attempts >= MAX_SAMPLE_ATTEMPTS) return final('not_measured', { reason: 'fetch_failed', valid_samples: usable.length, attempts }, baseline, samples)
    return { kind: 'pending', valid_samples: usable.length, attempts }
  }

  const used = usable.slice(0, MIN_VALID_SAMPLES)
  const counts = { valid_samples: used.length, attempts }
  if (used.some((s) => s.status === 'other_own_page')) return final('not_measured', { ...counts, reason: 'url_changed' }, baseline, used)

  const rankedCount = used.filter((s) => s.status === 'ranked').length
  if (rankedCount > 0 && rankedCount < used.length) return final('unstable', counts, baseline, used)

  if (rankedCount === 0) {
    return baseline.status === 'ranked'
      ? final('dropped_out', counts, baseline, used)
      : final('not_measured', { ...counts, reason: 'never_ranked' }, baseline, used)
  }
  if (baseline.status === 'not_in_top_n' || baseline.rank_group === null) return final('entered_top_n', counts, baseline, used)
  return compareToBaseline(baseline.rank_group, used.map((s) => s.rank_group as number), baseline, used, counts)
}
