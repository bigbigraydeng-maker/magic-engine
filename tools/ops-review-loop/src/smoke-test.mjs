/**
 * Manual, one-shot validation for ME2-OPS02 required-validation item #6:
 * does the native Codex GitHub App accept a bot-authored "@codex review"
 * comment? This session has no live GitHub access to answer that, so it is
 * left as a workflow_dispatch a human runs once (ops-codex-smoke-test.yml)
 * against a harmless, already-open PR.
 */
import { createIssueComment } from './github.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const pr = Number(process.env.PR_NUMBER)

if (!Number.isInteger(pr) || pr <= 0) {
  throw new Error(`PR_NUMBER must be a positive integer, got: ${process.env.PR_NUMBER}`)
}

await createIssueComment(
  token,
  owner,
  repo,
  pr,
  '@codex review\n\n<!-- ops-codex-loop:smoke-test -->\n\nME2-OPS02 smoke test: this comment was posted by github-actions[bot] via workflow_dispatch, to check whether the native Codex GitHub App treats a bot-authored review request the same as a human-authored one.'
)
console.log(`Posted smoke-test "@codex review" comment on PR #${pr}. Now watch the PR for a Codex response.`)
