/**
 * Workflow B (ops-codex-to-claude-fix.yml), step 3 — runs only when
 * handle-review.mjs decided 'dispatch-fix', after the Claude Action step has
 * finished (success or not).
 *
 * Codex finding (PR #906, P2): the previous design wrote the fix-dispatched
 * marker from inside handle-review.mjs, before the Claude Action step even
 * started. A timeout, auth failure, or failed push then still counted as a
 * used round, and decideStage's dedup check (hasMarkerForSha) would skip that
 * same sha forever after — not even a manual re-run of the failed job could
 * recover it, since re-running replays the same event and the marker was
 * already posted.
 *
 * Fix: post the marker ONLY on success. On failure, post a visible warning
 * instead and post no marker — so the next event for the same head sha (a
 * fresh Codex review, or a manual re-run of this same job replaying the
 * original event) sees no fix-dispatched marker yet and retries the same
 * round number rather than either silently stalling or skipping ahead.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, getPullRequest } from './github.mjs'
import { buildMarker } from './markers.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const sha = event.pull_request.head.sha
const round = process.env.ROUND
const outcome = process.env.OUTCOME

// Observed on PR #931 (2026-08-12 04:19, 04:41, 04:51): three rounds each
// exited `success` having pushed nothing, and each announced "pushed the
// change" anyway. Every commit on that branch turned out to be hand-pushed.
// The usual cause is that the findings sit in files the dispatch prompt
// forbids Claude from editing (`.github/workflows/**`, `tools/ai-orchestrator/**`).
//
// A step's exit code is not evidence that a commit exists. Those three rounds
// also consumed the entire 3-round budget, so the loop then declared NEEDS
// HUMAN REVIEW ("3 rounds without a clean review") about work it had never
// actually attempted.
//
// Codex finding (PR #943, P2) — the first version of this fix compared against
// the sha in the review event, which is a stale baseline. Anything pushed
// between the review landing and this step (a human, another automation, a
// second window on the branch) would have been credited to Claude and charged
// against the budget. That is the same error as trusting the exit code,
// pointing the other way: neither says WHO moved the head.
//
// `HEAD_BEFORE` is read one step before claude-code-action runs (the `baseline`
// step in ops-codex-to-claude-fix.yml, inline on purpose — see the note there),
// so this comparison brackets exactly this round. If it is missing — the step
// was skipped, or a future edit dropped it — fall back to reporting no push
// rather than guessing: over-reporting is the failure this file exists to stop.
const headBefore = process.env.HEAD_BEFORE
const headNow = (await getPullRequest(token, owner, repo, pr))?.head?.sha
const pushedSomething =
  typeof headBefore === 'string' &&
  /^[0-9a-f]{40}$/.test(headBefore) &&
  typeof headNow === 'string' &&
  headNow !== headBefore

// Codex finding (PR #943, P2). What decides whether a round was consumed is
// whether a commit landed — not whether the action exited cleanly. Those are
// different facts, and the earlier shape only asked the second one on two of
// the three paths: a round that pushed a commit and THEN failed inside the
// action fell into the failure branch, which announced "no change was pushed"
// without ever checking, and wrote no marker. The commits are real and go on
// to trigger further reviews, so the cap could be exceeded while the loop
// insisted nothing had happened.
//
// Branch on the push, then describe the outcome — rather than branching on the
// outcome and assuming the push.
if (pushedSomething) {
  const marker = buildMarker({ stage: 'fix-dispatched', pr, sha, round })
  const note =
    outcome === 'success'
      ? `Codex will review the new head next.`
      : `⚠️ The action then reported \`${outcome}\`, so the fix may be incomplete — but the commit is real, so this round **is** counted. Codex will review the new head next.`
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    `Completed automated fix round ${round} for Codex findings and pushed \`${headNow.slice(0, 10)}\`. ${note}\n\n${marker}`
  )
} else if (outcome === 'success') {
  // Green step, unchanged head. Deliberately writes NO fix-dispatched marker:
  // a round that changed nothing must not consume one of the three, and the
  // findings must not be reported as handled when they are not.
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    // Codex finding (PR #943, P2): this used to print the sha from the review
    // event. In the very scenario the new baseline exists to handle — review
    // on commit A, someone pushes B, this round pushes nothing — that sentence
    // publicly claims the head is still A. Fixing the accounting while still
    // reporting the wrong commit swaps one false statement for another.
    // Report what was actually read.
    `⚠️ Automated fix round ${round} ran without error but **pushed no commit** — the branch head is \`${String(headNow ?? headBefore ?? 'unknown').slice(0, 10)}\`, unchanged by this round, so the Codex findings are **not** addressed.\n\nThe usual cause is findings in files the fix prompt forbids Claude from editing (\`.github/workflows/**\`, \`tools/ai-orchestrator/**\`); those need a human. This round is **not** counted against the 3-round limit.`
  )
} else {
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    // Reached only when the head genuinely did not move, so "no commit was
    // pushed" is now a verified statement rather than an assumption about what
    // a failing action must have done.
    `⚠️ Automated fix round ${round} did not finish successfully (outcome: \`${outcome}\`) and **no commit was pushed** — the branch head is still \`${String(headNow ?? headBefore ?? 'unknown').slice(0, 10)}\`. This round is **not** counted against the 3-round limit; a fresh Codex review on this same head, or a manual re-run of this job, will retry it. Check the workflow run logs if this keeps happening.`
  )
}
