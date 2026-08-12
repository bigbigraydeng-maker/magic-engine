/**
 * Codex finding (PR #906, P2): a clean Codex review that lands before CI has
 * finished produces `wait-ci` and nothing else — this workflow only listens to
 * `pull_request_review.submitted`, so CI turning green afterward never
 * re-triggers a decision for that same head sha, and a PR that already meets
 * the bar can go without a terminal comment indefinitely.
 *
 * Fix: poll within the same run, bounded by attempts and interval, before
 * giving up. `fetchCheckRuns` and `sleep` are injected so this stays testable
 * without real network calls or real waiting.
 *
 * Generalised 2026-08-12 (auto-merge): the caller now decides what "settled"
 * means via `isSettled`, because the auto-merge gate has to wait for EVERY
 * check on the sha rather than one check matched by name. Returning the whole
 * check-run list rather than a single run is part of the same change — see
 * merge-gate.mjs for why one-check-of-four was safe under a human gate and is
 * not safe under auto-merge.
 */
export async function waitForChecks({ fetchCheckRuns, sleep, isSettled, maxAttempts = 12, intervalMs = 20000 }) {
  let checkRuns = []
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    checkRuns = (await fetchCheckRuns()) ?? []
    if (isSettled(checkRuns)) {
      return checkRuns
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs)
    }
  }
  // Return the last observed state rather than null: the caller's own gate
  // decides what an unsettled list means, and handing back `null` would make
  // "timed out" indistinguishable from "no checks exist".
  return checkRuns
}
