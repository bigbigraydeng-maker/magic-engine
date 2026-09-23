/**
 * Industry AI Visibility — "was this probe conclusive?" predicate.
 *
 * 红线（CLAUDE.md 铁律 8 / docs/PITFALLS.md D12）：一次没能完成的测量，不是
 * 一次"测出来是零"的测量。A probe we failed to take is NOT a measurement of
 * zero. Every downstream consumer that turns snapshots into a number MUST
 * exclude non-conclusive rows from BOTH numerator and denominator, and report
 * "not computable" when too few conclusive rows remain.
 *
 * Why a predicate and not a plain `error_code IS NULL` filter:
 * `industry_ai_visibility_snapshots` does not persist the collector's `ok`
 * flag — only `error_code`. And `error_code` carries TWO different meanings:
 *
 *   - 'no_ai_overview'  → the collection SUCCEEDED; Google simply did not
 *                         surface an AI Overview for this query. That is a
 *                         genuine zero and must stay in the denominator.
 *                         (collector.ts sets ok:true for this branch.)
 *   - anything else     → the collection FAILED (quota exhausted, provider
 *                         error, bad request). Nothing was measured.
 *
 * Filtering on `error_code IS NULL` alone would silently drop every legitimate
 * "Google showed no AI Overview" row and bias scores UPWARD. Counting every
 * non-null `error_code` as a failure would report a healthy platform as 100%
 * broken. Hence this single shared allowlist.
 *
 * Fail-closed: any error_code not on the allowlist is treated as a failed
 * probe. A future collector branch that means "succeeded but empty" must be
 * added here explicitly.
 */

/**
 * error_code values that mean "the probe completed; the empty result is real".
 * Keep in sync with the ok:true branches of collector.ts.
 */
export const SUCCESSFUL_EMPTY_ERROR_CODES: readonly string[] = ['no_ai_overview']

/**
 * The shape every caller needs — matches the snapshots table column.
 *
 * Deliberately `string | null`, NOT `string | null | undefined`: a caller whose
 * `.select()` forgot `error_code` would otherwise have every row silently
 * classified as a completed measurement — the exact failure this module exists
 * to prevent. Keeping `undefined` out makes that a compile error.
 */
export interface SnapshotConclusiveness {
  error_code: string | null
}

/**
 * True when this snapshot row represents a completed measurement, so its
 * (possibly empty) brand lists may be counted as real evidence.
 */
export function isSnapshotConclusive(row: SnapshotConclusiveness): boolean {
  const code = row.error_code
  if (code === null) return true
  return SUCCESSFUL_EMPTY_ERROR_CODES.includes(code)
}

/** Split rows into the ones we may score and the ones we must not. */
export function partitionConclusiveSnapshots<T extends SnapshotConclusiveness>(
  rows: readonly T[],
): { conclusive: T[]; failed: T[] } {
  const conclusive: T[] = []
  const failed: T[] = []
  for (const row of rows) {
    if (isSnapshotConclusive(row)) conclusive.push(row)
    else failed.push(row)
  }
  return { conclusive, failed }
}

/**
 * Human-readable breakdown of why a batch was rejected — used verbatim in the
 * ok:false reason so FDE/PM can tell "AI 没提到我们" apart from "这次根本没测成".
 */
export function summariseFailureCodes(rows: readonly SnapshotConclusiveness[]): string {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const code = row.error_code ?? 'unknown'
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code}×${n}`)
    .join(', ')
}

// ─── Question-level completeness ─────────────────────────────────────────────
//
// Row-level filtering alone is NOT enough, because a score is computed per
// QUESTION while a question has one row per platform (chatgpt /
// google_ai_overview / google_serp). Two failure modes, in opposite
// directions, both produce a wrong number:
//
//   Keep partially-measured questions in the denominator
//     → a question whose only surviving platform missed is scored as a miss,
//       even though the platform that failed might have been the one that hit.
//       Biases DOWN (measured at up to −46% on 2026-09-20 production data).
//
//   Keep hits but drop non-hits that were partially measured
//     → on a day where every question is partial, only hits survive and the
//       score becomes 100%. Biases UP, catastrophically.
//
// So: complete-case analysis. Only questions whose every platform row is
// conclusive are scored — as a hit or as a miss. Everything else is evidence
// we do not have, and is excluded from both numerator and denominator.

/**
 * Minimum share of the day's questions that must be fully measured before a
 * score is trustworthy enough to publish.
 *
 * This is a judgement call, and it exists because the missingness is NOT
 * random: as of 2026-09 every city-scoped question fails at the SERP provider
 * while national ones succeed, so a partially-collected day leaves a sample
 * skewed towards national questions. A plain n>=5 gate would happily score
 * restaurant off 3 surviving national questions out of 18. Until collection is
 * healthy again, refusing to publish is the honest answer.
 *
 * Calibrated against production: healthy days (through 2026-09-09, and
 * 2026-09-03 spot-checked) sit at 100% and pass untouched.
 */
export const MIN_FULL_COVERAGE_RATIO = 0.6

export interface QuestionCoverage<T> {
  /** Questions whose every platform row completed — the only scorable set. */
  fullyMeasured: Map<string, T[]>
  /** Question ids with some rows conclusive and some failed. */
  partialQuestionIds: string[]
  /** Question ids where every row failed. */
  failedQuestionIds: string[]
  /** Total distinct questions seen, scorable or not. */
  totalQuestions: number
}

/**
 * Group snapshot rows by question and classify each question's coverage.
 * Callers score `fullyMeasured` only.
 */
export function groupQuestionCoverage<
  T extends SnapshotConclusiveness & { question_id: string },
>(rows: readonly T[]): QuestionCoverage<T> {
  const byQuestion = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = byQuestion.get(row.question_id)
    if (bucket) bucket.push(row)
    else byQuestion.set(row.question_id, [row])
  }

  const fullyMeasured = new Map<string, T[]>()
  const partialQuestionIds: string[] = []
  const failedQuestionIds: string[] = []

  for (const [questionId, questionRows] of byQuestion) {
    const conclusiveCount = questionRows.filter(isSnapshotConclusive).length
    if (conclusiveCount === questionRows.length) fullyMeasured.set(questionId, questionRows)
    else if (conclusiveCount === 0) failedQuestionIds.push(questionId)
    else partialQuestionIds.push(questionId)
  }

  return {
    fullyMeasured,
    partialQuestionIds,
    failedQuestionIds,
    totalQuestions: byQuestion.size,
  }
}
