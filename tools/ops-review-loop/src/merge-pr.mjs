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
 * It re-reads nothing and re-decides nothing — every gate was evaluated in
 * handle-review.mjs, which only emits `action=auto-merge` when all of them are
 * clear. The one protection repeated here is the expected head sha, because
 * that is a race this job can still lose: if the branch moved between the two
 * jobs, GitHub rejects the merge with 409 and this run fails loudly rather than
 * shipping a commit nobody reviewed.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, getPullRequest, listCheckRunsForRef, mergePullRequest } from './github.mjs'
import { isEveryCheckGreen } from './merge-gate.mjs'
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
if (process.env.AUTO_MERGE_ENABLED !== 'true') {
  console.log('OPS_AUTO_MERGE_ENABLED is no longer "true" — standing down without merging.')
  process.exit(0)
}

const pr_ = await getPullRequest(token, owner, repo, pr)
if (pr_?.state !== 'open' || pr_?.draft === true || pr_?.mergeable !== true) {
  throw new Error(
    `Pull request is no longer mergeable at merge time (state=${pr_?.state}, draft=${pr_?.draft}, mergeable=${pr_?.mergeable}).`,
  )
}
if (pr_?.head?.sha !== sha) {
  throw new Error(`Head moved between the gate and the merge: expected ${sha}, found ${pr_?.head?.sha}.`)
}
if (!isEveryCheckGreen(await listCheckRunsForRef(token, owner, repo, sha))) {
  throw new Error(`Not every check run on ${sha.slice(0, 10)} is still completed and green.`)
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
