/**
 * AI Tracker — "did this run actually get measured?" predicate.
 *
 * 红线（CLAUDE.md 铁律 8 / docs/PITFALLS.md D12）：一次没能完成的探测，不是
 * 一次"探测出来是零"的探测。A probe we failed to take is NOT a measurement of
 * zero. Every consumer that turns `ai_visibility_runs` rows into a number MUST
 * exclude non-conclusive rows from BOTH numerator and denominator, and report
 * "not computable" when nothing conclusive remains.
 *
 * Why this exists as a module and not an inline `.is('error_message', null)`:
 * `orchestrator.processOne` deliberately INSERTS a row even when the runner
 * throws, so the failure is preserved as history (playbook-geo §8). The price
 * is that a failed row's empty fields — `brands_mentioned: []`,
 * `client_brand_rank: null` — are indistinguishable from a genuine "the AI
 * did not mention us" unless the reader checks the error columns. Keeping the
 * check in one place means a new consumer inherits it instead of re-deriving
 * it (and getting it wrong).
 *
 * TWO columns, not one. A run is only evidence when both legs completed:
 *   - `error_message`        → the engine call itself failed (or was disabled).
 *                              Nothing was asked, nothing was answered.
 *   - `parse_error_message`  → the engine answered, but the parser that turns
 *                              that answer into rankings blew up. The answer
 *                              may well have named the client; we simply do
 *                              not know. `client_brand_rank` stays null for
 *                              the same reason it stays null on a real miss,
 *                              which is exactly the trap.
 *
 * Why there is NO allowlist here, unlike `industry-ai-visibility/
 * snapshot-conclusive.ts`: that table stores an enumerated `error_code`, where
 * `no_ai_overview` means "collection succeeded, the emptiness is real" and has
 * to stay in the denominator. This table stores a free-text driver message
 * instead — `runners/*.ts` write it only from a catch block or the
 * disabled-engine guard — and free-text matching would be the wrong tool for
 * an allowlist anyway.
 *
 * ⚠️ That does NOT mean no "succeeded but empty" case exists. One does, and it
 * lives a layer down: a runner returns `content ?? ''` with
 * `error_message: null` when a model refuses or truncates, so an empty answer
 * reaches the parser looking like a successful call. `parser.ts` therefore
 * THROWS on a too-short response instead of returning an empty ranking, which
 * routes it to `parse_error_message` and lets this predicate reject it. If you
 * are adding a branch anywhere in that chain that means "we got nothing back",
 * it must end in one of these two columns — never in a quietly empty result.
 */

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
 * Fail-closed: anything in either error column means "not measured".
 */
export function isRunConclusive(row: RunConclusiveness): boolean {
  return row.error_message === null && row.parse_error_message === null
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
 *
 * Messages are free-text driver output, so they are bucketed by leg rather
 * than by exact string: an aggregate of 47 distinct timeout texts helps no one.
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
