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

// Observed on PR #931 (2026-08-12 04:19): the Claude Action step exited
// `success` having pushed nothing — two of the three Codex findings were in
// `.github/workflows/**`, which the dispatch prompt explicitly forbids Claude
// from touching. The comment nevertheless announced "pushed the change", and
// the branch head was byte-identical before and after. A step's exit code is
// not evidence that a commit exists; only the head sha is.
const headNow = (await getPullRequest(token, owner, repo, pr))?.head?.sha
const pushedSomething = typeof headNow === 'string' && headNow !== sha

if (outcome === 'success' && pushedSomething) {
  const marker = buildMarker({ stage: 'fix-dispatched', pr, sha, round })
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    `Completed automated fix round ${round} for Codex findings and pushed \`${headNow.slice(0, 10)}\`. Codex will review the new head next.\n\n${marker}`
  )
} else if (outcome === 'success') {
  // Green step, unchanged head. Deliberately posts NO fix-dispatched marker:
  // a round that changed nothing must not consume one of the three, and the
  // findings must not be reported as handled when they are not.
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    `⚠️ Automated fix round ${round} ran without error but **pushed no commit** — the branch head is still \`${sha.slice(0, 10)}\`, so the Codex findings are **not** addressed.\n\nThe usual cause is that the findings are in files the fix prompt forbids Claude from editing (\`.github/workflows/**\`, \`tools/ai-orchestrator/**\`). Those need a human. This round is **not** counted against the 3-round limit.`
  )
} else {
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    `⚠️ Automated fix round ${round} did not finish successfully (outcome: \`${outcome}\`) — no change was pushed. This round is **not** counted against the 3-round limit; a fresh Codex review on this same head, or a manual re-run of this job, will retry it. Check the workflow run logs if this keeps happening.`
  )
}
