/**
 * Workflow A entrypoint (ops-codex-request-review.yml). Runs on every push to
 * a qualifying PR. Posts "@codex review" exactly once per head sha — nothing
 * else. Never merges, never deploys, never touches production.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, listIssueComments } from './github.mjs'
import { buildMarker, parseMarkers } from './markers.mjs'

// Two tokens on purpose, split by what each one is actually for.
//
// Only the POST needs the Product Owner's identity — that is the whole point of
// this workflow (Codex ignores github-actions[bot]). The dedup READ needs no
// identity at all, so it uses the ambient GITHUB_TOKEN, which always has the
// access and costs no extra permission on the PAT.
//
// Learned the hard way on PR #927 (2026-08-12 03:28): the first live run failed
// with `GET /issues/927/comments -> 404`, GitHub's way of saying the
// fine-grained PAT could not see that resource. Issue comments live under the
// Issues API even on a pull request, so a PAT granted only "Pull requests"
// 404s here. Reading with GITHUB_TOKEN removes that failure mode entirely and
// shrinks what the PAT has to be granted.
const readToken = process.env.GITHUB_TOKEN
const postToken = process.env.REVIEW_REQUEST_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const sha = event.pull_request.head.sha

const comments = await listIssueComments(readToken, owner, repo, pr)
const markers = parseMarkers(comments.map((c) => c.body))

if (markers.some((m) => m.stage === 'review-requested' && m.sha === sha)) {
  console.log(`Codex review already requested for PR #${pr} at ${sha}. Skipping (dedup).`)
  process.exit(0)
}

const marker = buildMarker({ stage: 'review-requested', pr, sha })
// The one call that must carry the Product Owner's identity.
await createIssueComment(postToken, owner, repo, pr, `@codex review\n\n${marker}`)
console.log(`Requested Codex review for PR #${pr} at ${sha}.`)
