/**
 * AI Tracker — "did this probe actually complete?" predicate.
 *
 * 红线（CLAUDE.md 铁律 8）：一次没能完成的测量，不是一次"测出来是零"的测量。
 * A probe we failed to take is NOT a measurement of zero.
 *
 * `ai_visibility_runs` keeps failed probes on purpose (orchestrator inserts the
 * row first, then records the failure on it), which is right — but it means a
 * failed row looks exactly like a successful one to any reader that only
 * selects `client_brand_rank`: both carry `client_brand_rank = null`. Every
 * downstream consumer that turns runs into a number MUST therefore exclude
 * non-conclusive rows from BOTH numerator and denominator, and report
 * "not computable" when no conclusive row survives.
 *
 * Measured on production 2026-09-23: 561 of the 1360 runs in the trailing 30
 * days (41%) never produced a measurement — 542 provider failures (Gemini fetch
 * errors and an exhausted OpenAI balance) plus 19 parser failures — every one of
 * them carrying a null rank that the strategy analyzer was counting as "AI ranks
 * this client badly". Both kinds matter: readers that check only `error_message`
 * still let the 19 parser failures through, which is why the predicate covers
 * both columns rather than the obvious one.
 *
 * Sister module to `industry-ai-visibility/snapshot-conclusive.ts`, but the two
 * tables mark failure differently and the predicates must NOT be shared:
 *   - snapshots use `error_code`, where the code `no_ai_overview` means the
 *     collection SUCCEEDED and the empty result is a genuine zero — hence that
 *     module needs an allowlist.
 *   - runs use free-text `error_message` / `parse_error_message`, and both are
 *     written only on real failure. There is no "succeeded but empty" message:
 *     a run that completed and simply did not mention the client is stored with
 *     both columns NULL and `client_brand_rank = null`. So here NULL means
 *     "completed", and an allowlist would be wrong.
 *
 * Fail-closed: anything other than NULL — including `undefined`, which is what
 * a caller that forgot the columns in its `.select()` would hand us — counts as
 * a failed probe. Better to produce no opportunities at all than confident ones
 * built on measurements we never took.
 *
 * KNOWN RESIDUAL GAP (write side, out of this module's reach): if the
 * post-parse UPDATE in `ai-tracker/orchestrator.ts` fails, the row keeps both
 * error columns NULL with a null rank, and reads here as a completed probe that
 * found nothing. Closing that needs a write-side fix in the orchestrator.
 */

/**
 * The shape every caller must select. Deliberately `string | null`, NOT
 * `string | null | undefined`, to state the contract: a row without these
 * columns is not a row this module can judge.
 *
 * The type alone does NOT enforce it. `src/lib/supabase.ts` calls
 * `createClient` without a `Database` generic, so every `.select()` resolves to
 * `any` and any cast onto this interface is accepted — verified 2026-09-23 by
 * dropping the columns from a caller's select and getting a clean `tsc`. The
 * enforcement is therefore at runtime, in `isRunConclusive` below: a missing
 * column reads as `undefined`, which is not `null`, and the row is rejected.
 * Keep it that way — do not "simplify" the check to a falsy test.
 */
export interface RunConclusiveness {
  error_message: string | null
  parse_error_message: string | null
}

/** Columns a `.select()` must include to satisfy `RunConclusiveness`. */
export const RUN_CONCLUSIVENESS_COLUMNS = 'error_message, parse_error_message'

/**
 * True when this run represents a completed probe, so its rank — including a
 * null rank, meaning "the AI answered and did not mention the client" — may be
 * counted as real evidence.
 */
export function isRunConclusive(row: RunConclusiveness): boolean {
  return row.error_message === null && row.parse_error_message === null
}

/** Split runs into the ones we may score and the ones we must not. */
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
 * Human-readable breakdown of why a batch was rejected, so FDE/PM can tell
 * "AI 没提到我们" apart from "这次根本没测成". Buckets rather than verbatim
 * messages, because `error_message` holds full provider stack text.
 */
export function summariseRunFailures(rows: readonly RunConclusiveness[]): string {
  let providerError = 0
  let parseError = 0
  let unreadable = 0
  for (const row of rows) {
    if (row.error_message != null) providerError++
    else if (row.parse_error_message != null) parseError++
    // Neither column says why, yet isRunConclusive() rejected the row: the
    // caller's select omitted them. Name it instead of folding it into a real
    // failure bucket — the fix is in the caller, not the provider.
    else unreadable++
  }
  const parts: string[] = []
  if (providerError > 0) parts.push(`provider_error×${providerError}`)
  if (parseError > 0) parts.push(`parse_error×${parseError}`)
  if (unreadable > 0) parts.push(`missing_error_columns×${unreadable}`)
  return parts.join(', ')
}
