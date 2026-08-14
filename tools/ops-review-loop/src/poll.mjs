/**
 * Codex finding (PR #906, P2): a clean Codex review that lands before the
 * required check has finished produces `wait-ci` and nothing else — this
 * workflow only listens to `pull_request_review.submitted`, so CI turning
 * green afterward never re-triggers a decision for that same head sha, and a
 * PR that already meets the bar can go without READY FOR PRODUCT OWNER
 * indefinitely.
 *
 * Fix: poll the required check within the same run, bounded by attempts and
 * interval, before giving up and falling back to `wait-ci`. `fetchCheckRuns`
 * and `sleep` are injected so this stays testable without real network calls
 * or real waiting.
 *
 * Codex finding (PR #943, P2): returning a bare `null` on timeout threw away
 * the difference between "the required check does not exist on this commit"
 * and "it exists and is still running". The caller could only see absence, so
 * a normal slow-starting check was reported to maintainers as "never reported
 * on this commit" — a confident, wrong diagnosis pointing them at the wrong
 * problem. That is the same failure this polling exists to prevent, one level
 * up.
 *
 * So: return `{ check, sawIt, runs }`. `check` is the completed run when one
 * was seen, otherwise the last observation of it (possibly still
 * queued/running); `sawIt` says whether the check was ever present at all; and
 * `runs` is the whole list as last observed, so the caller can describe the
 * other checks as they are now rather than as they were before the wait.
 */
export async function waitForRequiredCheck({ fetchCheckRuns, sleep, pattern, maxAttempts = 12, intervalMs = 20000 }) {
  let lastSeen = null
  let lastRuns = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const checkRuns = await fetchCheckRuns()
    lastRuns = checkRuns
    const requiredCheck = checkRuns.find((run) => pattern.test(run.name))
    if (requiredCheck) {
      lastSeen = requiredCheck
    }
    if (requiredCheck?.status === 'completed') {
      return { check: requiredCheck, sawIt: true, runs: checkRuns }
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs)
    }
  }
  // Codex finding (PR #943, P2): the caller also needs the whole list as last
  // observed. Reporting from the pre-poll snapshot describes the world as it
  // was minutes ago — and mixing the two lists shows the same check twice, in
  // two contradictory states.
  return { check: lastSeen, sawIt: lastSeen !== null, runs: lastRuns }
}
