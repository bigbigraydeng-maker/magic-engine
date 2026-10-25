/**
 * Actionable-finding heuristic: a P0/P1/P2 tag anywhere in the text. The real
 * Codex output format has not been observed in a live run yet (this session
 * has no network access to test against the native Codex GitHub App), so this
 * is deliberately a loose, conservative match rather than a strict parser —
 * false positives just mean an extra fix round, false negatives mean a real
 * finding silently never reaches Claude, which is the worse failure mode.
 */
const SEVERITY_RE = /\bP[0-2]\b/i

/**
 * P0/P1 only. Observed on PR #3080: Codex marks a finding with a shields.io
 * badge whose alt text and URL both contain the tag (`badge/P2-yellow`,
 * `P2 Badge`) plus `<!-- codex-code-review-finding:v1 -->`. P2 is a suggestion.
 * It must not block B/C auto-merge; P0 and P1 do, until the thread is resolved.
 */
const MERGE_BLOCKING_RE = /\bP[01]\b/i

export function isActionable(text) {
  return typeof text === 'string' && SEVERITY_RE.test(text)
}

/**
 * True when the text carries a P0 or P1 tag. P2 and prose such as
 * "Didn't find any major issues" are not blocking.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function isMergeBlockingSeverity(text) {
  return typeof text === 'string' && MERGE_BLOCKING_RE.test(text)
}
