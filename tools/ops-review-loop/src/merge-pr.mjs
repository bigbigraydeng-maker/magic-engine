/**
 * The merge job's only script (ops-codex-to-claude-fix.yml, job `merge`).
 *
 * Codex finding (PR #931, P1): merging used to happen inside the same job that
 * runs `anthropics/claude-code-action`. That job therefore needed
 * `contents: write`, which the ambient GITHUB_TOKEN handed to that third-party
 * action on every run — including runs where no merge was ever going to happen.
 * A compromise in the action or any of its dependencies would have had repo
 * write access for free.
 *
 * This file exists so that write scope lives in a job that runs nothing else:
 * no third-party action, no model, no prompt. It performs one API call.
 *
 * It re-reads and re-verifies every gate that can change WITHOUT the head sha
 * changing — the kill switch, PR state, draft, mergeable, base branch and
 * repository, and every check run. All of those are mutable in the window
 * between the two jobs, so checking only the sha would sail straight past an
 * admin turning auto-merge off, a check re-run back to red, or a retargeted
 * base. (An earlier version of this comment claimed the opposite; it was
 * written before those re-checks existed and was left stale — the same drift
 * this loop keeps catching elsewhere.)
 *
 * Whatever it decides, it says so on the PR. A merge job that stands down in
 * silence is indistinguishable from one that never ran.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, getPullRequest, listCheckRunsForRef, listReviewComments, mergePullRequest } from './github.mjs'
import { excludeOwnRun, isCleanReview, isEveryCheckGreen } from './merge-gate.mjs'
import { isActionable } from './severity.mjs'
import { buildMarker } from './markers.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const sha = process.env.MERGE_SHA

if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
  throw new Error(`MERGE_SHA must be a full 40-character sha, got: ${sha}`)
}

// Codex finding (PR #931, P1): everything below was evaluated in the previous
// job. Between the two jobs an admin can flip OPS_AUTO_MERGE_ENABLED to false,
// or a check can be re-run back to pending/failure — neither of which changes
// the sha, so the sha check alone would sail straight past both. The README
// promises the kill switch "takes effect immediately"; that promise is only
// true if the job holding write access re-reads it at the last moment.
async function standDown(reason) {
  // Silence here would look exactly like "the automation never ran". Say it on
  // the PR, then exit 0 — standing down is a correct outcome, not a failure.
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    `**AUTO-MERGE STOOD DOWN**\n\nThe merge gate passed, but this final job re-checked before merging and stopped:\n\n- ${reason}\n\nNothing was merged. Push a commit or ask Codex to review again to re-run the gate.`,
  )
  process.exit(0)
}

if (process.env.AUTO_MERGE_ENABLED !== 'true') {
  await standDown('`OPS_AUTO_MERGE_ENABLED` is no longer `true` — the kill switch was turned off after the gate ran.')
}

// `mergeable` is computed asynchronously and reads null while GitHub works it
// out, so one read can say null purely by timing. Retry briefly before
// treating it as an answer — otherwise a merge that is perfectly fine fails on
// a race, and the noise trains everyone to ignore this job's failures.
let pr_ = null
for (let attempt = 0; attempt < 3; attempt++) {
  pr_ = await getPullRequest(token, owner, repo, pr)
  if (pr_?.mergeable !== null && pr_?.mergeable !== undefined) break
  if (attempt < 2) await new Promise((r) => setTimeout(r, 5000))
}
if (pr_?.state !== 'open' || pr_?.draft === true || pr_?.mergeable !== true) {
  await standDown(
    `the pull request is no longer mergeable (state=\`${pr_?.state}\`, draft=\`${pr_?.draft}\`, mergeable=\`${pr_?.mergeable}\`).`,
  )
}
// Codex finding (PR #931, P2): the job-level `if:` checks base.ref at event
// time, but the base can be retargeted afterwards without the head sha moving,
// and the merge API merges into whatever the base is *now*. Re-assert both the
// branch and the repository — every other re-check here exists for the same
// reason: it is mutable while the sha is not.
if (pr_?.base?.ref !== 'main' || pr_?.base?.repo?.full_name !== `${owner}/${repo}`) {
  await standDown(
    `the base was retargeted after the gate ran — expected \`${owner}/${repo}@main\`, found \`${pr_?.base?.repo?.full_name}@${pr_?.base?.ref}\`.`,
  )
}
if (pr_?.head?.sha !== sha) {
  await standDown(
    `the head moved after the gate ran — expected \`${sha.slice(0, 10)}\`, found \`${String(pr_?.head?.sha).slice(0, 10)}\`.`,
  )
}
// Codex finding (PR #931, P1): this job is itself a check run on this sha and
// is `in_progress` right now, so without excluding this workflow run the gate
// below could never be satisfied — auto-merge would have stood down every
// single time. Its sibling `handle-review` is in the same run and excluded by
// the same filter.
const otherChecks = excludeOwnRun(await listCheckRunsForRef(token, owner, repo, sha), process.env.GITHUB_RUN_ID)
if (!isEveryCheckGreen(otherChecks)) {
  await standDown(`not every check run on \`${sha.slice(0, 10)}\` is still completed and green.`)
}

// Codex finding (PR #931, P1), defence in depth: everything above trusts that
// the previous job only emits `auto-merge` for a clean review. That trust ran
// through GITHUB_OUTPUT, which was injectable via review text (see setOutput in
// handle-review.mjs). The injection itself is fixed, but this job holds the
// write scope, so it re-derives the verdict from the event payload rather than
// taking the handoff's word for it. Two independent reasons to believe the
// review was clean, not one.
const reviewBodies = [event.review?.body ?? '', ...(await listReviewComments(token, owner, repo, pr, event.review?.id)).map((c) => c.body ?? '')]
if (reviewBodies.some((b) => isActionable(b))) {
  await standDown('the triggering review contains actionable P0/P1/P2 findings — refusing to merge regardless of the handoff.')
}
if (!reviewBodies.some((b) => isCleanReview(b))) {
  await standDown('the triggering review carries no positive clean signal — refusing to merge regardless of the handoff.')
}

await mergePullRequest(token, owner, repo, pr, {
  sha,
  commitTitle: `Merge pull request #${pr} (auto-merged after clean Codex review)`,
})

const marker = buildMarker({ stage: 'auto-merged', pr, sha })
await createIssueComment(
  token,
  owner,
  repo,
  pr,
  `**AUTO-MERGED**\n\nCodex returned a clean review **of this exact commit** (\`${sha.slice(0, 10)}\`), every check run on it completed green, and the PR was not a draft. Merged without human review, per the Product Owner's 2026-08-12 decision.\n\n⚠️ \`main\` auto-deploys to Render, so this is now live. To stop this happening again, set repository variable \`OPS_AUTO_MERGE_ENABLED\` to \`false\` — it takes effect immediately and needs no PR.\n\n${marker}`
)
