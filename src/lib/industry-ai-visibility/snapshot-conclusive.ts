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

/** The shape every caller needs — matches the snapshots table column. */
export interface SnapshotConclusiveness {
  error_code: string | null | undefined
}

/**
 * True when this snapshot row represents a completed measurement, so its
 * (possibly empty) brand lists may be counted as real evidence.
 */
export function isSnapshotConclusive(row: SnapshotConclusiveness): boolean {
  const code = row.error_code
  if (code === null || code === undefined) return true
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
