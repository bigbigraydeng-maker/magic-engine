/**
 * Pure predicates for the auto-merge decision. No I/O, so every branch is
 * unit-testable offline (see tests/merge-gate.test.ts).
 *
 * WHY THESE ARE STRICTER THAN THE PRE-AUTO-MERGE VERSIONS
 * -------------------------------------------------------
 * Until 2026-08-12 a human was the last gate: a loose "is this clean?" check
 * that guessed wrong just meant the Product Owner opened the PR and looked.
 * With auto-merge on — and `main` auto-deploying to Render — the same guess
 * ships to production unreviewed. Both predicates below therefore FAIL CLOSED:
 * they answer "yes" only on positive evidence, never on absence of evidence.
 */

/**
 * Check-run conclusions that do not block a merge. `neutral` and `skipped` are
 * genuine non-results (a conditional job that correctly did not run);
 * everything else — failure, cancelled, timed_out, action_required, stale — is
 * treated as blocking.
 */
const NON_BLOCKING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])

/**
 * True only when EVERY check run on the head sha has completed with a
 * non-blocking conclusion.
 *
 * The predecessor of this function looked at exactly one check whose name
 * matched /ai-orchestrator/i and ignored the rest. On PR #927 that meant 1 of
 * 4 checks was consulted: a red build, a red Claude review and a red
 * Cloudflare deploy would all have read as "CI green". That is survivable
 * while a human still opens the page; it is not survivable once the machine
 * merges on this answer alone.
 *
 * Returns false for an empty list on purpose: "no checks reported" is not
 * evidence that anything passed, and on this repository it usually means the
 * checks have not been created yet.
 */
export function isEveryCheckGreen(checkRuns) {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) return false
  return checkRuns.every(
    (run) => run?.status === 'completed' && NON_BLOCKING_CONCLUSIONS.has(run?.conclusion),
  )
}

/**
 * Drop the check runs produced by THIS workflow run.
 *
 * Codex finding (PR #931, P1): a workflow's own jobs are check runs on the same
 * head sha. While `handle-review` polls for "every check green" it is itself
 * `in_progress`, and while `merge` re-checks before merging it is itself
 * `in_progress` — so both waited on themselves. Every green-check gate added
 * today was therefore unsatisfiable, and auto-merge could never have completed
 * even once.
 *
 * Identification is by run id from the check run's `details_url`, verified
 * against a real payload (2026-08-12) rather than assumed:
 *   https://github.com/{owner}/{repo}/actions/runs/{RUN_ID}/job/{JOB_ID}
 * Both jobs of one workflow run share that RUN_ID, so one filter removes both.
 * Matching on job *name* was rejected: names are free text a future edit can
 * change without anything noticing.
 *
 * If `runId` is missing this returns the list unchanged — excluding nothing is
 * the fail-closed direction here, since a smaller list can only make the gate
 * easier to satisfy.
 */
export function excludeOwnRun(checkRuns, runId) {
  if (!Array.isArray(checkRuns)) return []
  if (!runId) return checkRuns
  return checkRuns.filter((run) => !String(run?.details_url ?? '').includes(`/actions/runs/${runId}/`))
}

/**
 * Positive "Codex found nothing" signal.
 *
 * Observed clean output (PR #898, 2026-08-11 04:15):
 *   "Codex Review: Didn't find any major issues. What shall we delve into next?"
 *
 * Deliberately NOT "the text contains no P0/P1/P2 tag". That inverted form
 * treats every unrecognised shape — an API error page, an empty body, a
 * reworded template, a future Codex format — as clean. Under auto-merge the
 * inverted form is the difference between a gate and a decoration.
 *
 * Known gap, documented rather than papered over: Codex sometimes signals
 * "clean" with a 👍 reaction and submits no review at all. That produces no
 * `pull_request_review` event, so this loop never runs and the PR simply waits
 * for a human — the same outcome as before auto-merge existed. No regression,
 * but not a case this can close on its own.
 */
const CLEAN_REVIEW_PATTERNS = [
  /did(?:n't| not) find any major issues/i,
  /no (?:major )?issues found/i,
  /looks good to me\b/i,
]

export function isCleanReview(text) {
  if (typeof text !== 'string' || text.trim() === '') return false
  return CLEAN_REVIEW_PATTERNS.some((re) => re.test(text))
}

/**
 * Everything that must hold before the machine is allowed to merge. Each
 * blocker is returned by name so the PR comment can say exactly which one
 * stopped it — "auto-merge skipped" with no reason is how a broken gate hides.
 */
export function autoMergeBlockers({
  enabled,
  isDraft,
  mergeable,
  everyCheckGreen,
  cleanReview,
  reviewedSha,
  headSha,
}) {
  const blockers = []
  if (!enabled) blockers.push('auto-merge disabled (repository variable OPS_AUTO_MERGE_ENABLED)')
  // Codex finding (PR #931, P1). Codex reviews a specific commit and reports it
  // as `review.commit_id`. If anything pushed to the branch while that review
  // was being written, a clean verdict about commit A would otherwise authorise
  // merging commit B, which no reviewer has seen. Passing the head sha to the
  // merge API does NOT cover this: that only stops the branch moving *after*
  // the gate is computed, and this is a review that was already stale *before*
  // it. Auto-merge is exactly the setting where "reviewed something else" must
  // not read as "reviewed".
  if (typeof reviewedSha !== 'string' || typeof headSha !== 'string' || reviewedSha !== headSha) {
    blockers.push(`review is for ${String(reviewedSha).slice(0, 10)} but head is ${String(headSha).slice(0, 10)}`)
  }
  // A draft is the PR declaring about itself that it is not finished. Honouring
  // that is not an extra policy layer — it is reading the flag already there.
  if (isDraft) blockers.push('pull request is a draft')
  if (mergeable !== true) blockers.push(`not mergeable (mergeable=${JSON.stringify(mergeable)})`)
  if (!everyCheckGreen) blockers.push('not every check run is completed and green')
  if (!cleanReview) blockers.push('no positive clean signal in the Codex review')
  return blockers
}
