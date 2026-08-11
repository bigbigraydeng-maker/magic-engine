/**
 * Actionable-finding heuristic: a P0/P1/P2 tag anywhere in the text. The real
 * Codex output format has not been observed in a live run yet (this session
 * has no network access to test against the native Codex GitHub App), so this
 * is deliberately a loose, conservative match rather than a strict parser —
 * false positives just mean an extra fix round, false negatives mean a real
 * finding silently never reaches Claude, which is the worse failure mode.
 */
const SEVERITY_RE = /\bP[0-2]\b/i

export function isActionable(text) {
  return typeof text === 'string' && SEVERITY_RE.test(text)
}
