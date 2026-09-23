/**
 * "Was this ai_visibility_runs row conclusive?" predicate.
 *
 * ai_visibility_runs has TWO columns that indicate failure:
 *   - error_message      → the API call itself failed
 *   - parse_error_message → response came back but parsing failed
 *
 * A run is conclusive only when BOTH are null. When either is set the row
 * must be excluded from any scoring denominator — otherwise a failed probe
 * is silently counted as "AI didn't mention the brand" and inflates gap
 * signals. See playbook-geo-general §九.8.
 */

export interface RunConclusiveness {
  error_message: string | null
  parse_error_message: string | null
}

export function isRunConclusive(row: RunConclusiveness): boolean {
  return row.error_message === null && row.parse_error_message === null
}
