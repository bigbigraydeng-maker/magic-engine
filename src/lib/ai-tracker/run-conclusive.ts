/**
 * Shared predicate: did this AI-visibility run produce a conclusive measurement?
 *
 * A run is inconclusive when the provider call failed (`error_message`) or the
 * response parser failed (`parse_error_message`).  Both columns are nullable
 * text – a non-null, non-empty value means something went wrong.
 *
 * `no_ai_overview`-style codes live in `error_message` but are NOT failures —
 * they represent "the platform answered, but AI Overview wasn't displayed".
 * Those are true zeroes and MUST stay in the denominator.
 * Add any such codes to CONCLUSIVE_ERROR_CODES below.
 *
 * Pure function, zero external deps — safe for client components.
 */

/** Error codes that represent a successful (conclusive) measurement, not a failure. */
const CONCLUSIVE_ERROR_CODES = new Set<string>([
  'no_ai_overview',
])

/**
 * Returns true when the run produced a real measurement we can count.
 * Accepts any object with the two error fields (works with DB rows and typed objects).
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
