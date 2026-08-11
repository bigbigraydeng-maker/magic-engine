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
 */
export async function waitForRequiredCheck({ fetchCheckRuns, sleep, pattern, maxAttempts = 12, intervalMs = 20000 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const checkRuns = await fetchCheckRuns()
    const requiredCheck = checkRuns.find((run) => pattern.test(run.name))
    if (requiredCheck?.status === 'completed') {
      return requiredCheck
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs)
    }
  }
  return null
}
