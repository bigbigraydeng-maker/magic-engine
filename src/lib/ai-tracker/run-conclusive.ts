/**
 * AI Tracker — "did this run actually get measured?" predicate.
 *
 * 红线（CLAUDE.md 铁律 8 / docs/PITFALLS.md D12）：一次没能完成的探测，不是
 * 一次"探测出来是零"的探测。A probe we failed to take is NOT a measurement of
 * zero. Every consumer that turns `ai_visibility_runs` rows into a number MUST
 * exclude non-conclusive rows from BOTH numerator and denominator, and report
 * "not computable" when nothing conclusive remains.
 *
 * TWO columns, not one. A run is only evidence when both legs completed:
 *   - `error_message`        → the engine call itself failed (or was disabled).
 *   - `parse_error_message`  → the engine answered, but the parser blew up.
 *
 * `no_ai_overview`-style codes live in `error_message` but are NOT failures —
 * they represent "the platform answered, but AI Overview wasn't displayed".
 * Those are true zeroes and MUST stay in the denominator.
 *
 * Pure function, zero external deps — safe for client components.
 */

/** Error codes that represent a successful (conclusive) measurement, not a failure. */
const CONCLUSIVE_ERROR_CODES = new Set<string>([
  'no_ai_overview',
])

/**
 * The shape every caller needs — matches the `ai_visibility_runs` columns.
 *
 * Deliberately `string | null`, NOT `string | null | undefined`: a caller whose
 * `.select()` forgot one of these columns would otherwise have every row
 * silently classified as a completed measurement — the exact failure this
 * module exists to prevent. Keeping `undefined` out makes that a compile error.
 */
export interface RunConclusiveness {
  error_message: string | null
  parse_error_message: string | null
}

/** The columns a `.select()` must request for `isRunConclusive` to be sound. */
export const RUN_CONCLUSIVENESS_COLUMNS = 'error_message, parse_error_message'

/**
 * True when this run completed end to end, so its (possibly empty) brand list
 * and (possibly null) rank may be counted as real evidence.
 *
 * Accepts the broader `{ error_message?: string | null; ... }` shape so client
 * components and objects from different queries can use it directly.
 */
export function isRunConclusive(
  run: { error_message?: string | null; parse_error_message?: string | null },
): boolean {
  const err = run.error_message?.trim()
  if (err && !CONCLUSIVE_ERROR_CODES.has(err)) return false
  const parseErr = run.parse_error_message?.trim()
  if (parseErr) return false
  return true
}

/** Split rows into the ones we may score and the ones we must not. */
export function partitionConclusiveRuns<T extends RunConclusiveness>(
  rows: readonly T[],
): { conclusive: T[]; failed: T[] } {
  const conclusive: T[] = []
  const failed: T[] = []
  for (const row of rows) {
    if (isRunConclusive(row)) conclusive.push(row)
    else failed.push(row)
  }
  return { conclusive, failed }
}

/**
 * Human-readable breakdown of what failed — used verbatim in the skip reason
 * so FDE/PM can tell "AI 没提到我们" apart from "这次根本没探测成".
 */
export function summariseRunFailures(rows: readonly RunConclusiveness[]): string {
  let engineFailures = 0
  let parseFailures = 0
  for (const row of rows) {
    if (row.error_message !== null) engineFailures++
    else if (row.parse_error_message !== null) parseFailures++
  }
  const parts: string[] = []
  if (engineFailures > 0) parts.push(`${engineFailures} 次引擎调用失败`)
  if (parseFailures > 0) parts.push(`${parseFailures} 次结果解析失败`)
  return parts.join('，') || '无失败记录'
}
