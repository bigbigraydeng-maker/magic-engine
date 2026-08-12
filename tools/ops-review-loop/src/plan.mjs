/**
 * Pure decision function for the Codex-review -> Claude-fix leg. No I/O: the
 * caller has already fetched the PR's markers, this round's findings, and CI
 * status, so this is fully unit-testable offline (see tests/plan.test.ts).
 *
 * Dedup: keyed on (head sha, stage-about-to-be-written). If a marker for this
 * exact sha already exists for any terminal-or-dispatch stage, this event is a
 * duplicate delivery (or a second review on an unchanged head) and the run is
 * a no-op.
 *
 * Round cap: counted from the number of `fix-dispatched` markers already
 * posted for this PR (across all shas) — not from severities or arbitrary
 * event counts, so a duplicate-delivered event never inflates it, since
 * duplicates are already caught by the dedup check above.
 */
export function decideStage({
  markers,
  sha,
  reviewId = undefined,
  hasActionableFindings,
  ciSuccess,
  maxRounds,
  mergeBlockers = null,
}) {
  const hasMarkerForSha = (stage) => markers.some((m) => m.stage === stage && m.sha === sha)

  // Terminal for the commit: a fix was dispatched for it, automation gave up on
  // it, or it was merged. Nothing later should re-open any of those.
  if (hasMarkerForSha('fix-dispatched') || hasMarkerForSha('needs-human') || hasMarkerForSha('auto-merged')) {
    return { action: 'skip', reason: `already handled head sha ${sha}` }
  }

  // `ready` is NOT terminal, and treating it as such was a real bug.
  //
  // Codex finding (PR #931, P1): `ready` is now reachable from purely temporary
  // conditions — the kill switch being off, the PR still being a draft, or a
  // clean review that turned out to be for an older commit. Deduplicating it by
  // commit meant one stale-but-clean review poisoned that commit: the genuine
  // review of the same commit, P1 findings and all, was skipped before its
  // findings were even read. No fix, no NEEDS HUMAN, no comment.
  //
  // Dedup on (commit, review) instead. A duplicate delivery of the same review
  // is still a no-op; a different review of the same commit is not.
  if (markers.some((m) => m.stage === 'ready' && m.sha === sha && m.review !== undefined && m.review === reviewId)) {
    return { action: 'skip', reason: `already reported ready for review ${reviewId} on ${sha}` }
  }

  if (hasActionableFindings) {
    const round = markers.filter((m) => m.stage === 'fix-dispatched').length + 1
    if (round > maxRounds) {
      return { action: 'needs-human', round }
    }
    return { action: 'dispatch-fix', round }
  }

  if (!ciSuccess) {
    return { action: 'wait-ci' }
  }

  // `mergeBlockers === null` means the caller did not evaluate the merge gate
  // at all, which must not be read as "nothing is blocking". Auto-merge
  // requires an explicit, empty blocker list — absence of an answer is not a
  // yes. (Same fail-closed rule as merge-gate.mjs; see its header.)
  if (Array.isArray(mergeBlockers) && mergeBlockers.length === 0) {
    return { action: 'auto-merge' }
  }

  return { action: 'ready', blockers: mergeBlockers ?? ['merge gate not evaluated'] }
}
