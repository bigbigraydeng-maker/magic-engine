/**
 * Workflow A entrypoint (ops-codex-request-review.yml). Runs on every push to
 * a qualifying PR. Posts "@codex review" exactly once per head sha — nothing
 * else. Never merges, never deploys, never touches production.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, listIssueComments } from './github.mjs'
import { buildMarker, parseMarkers } from './markers.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const sha = event.pull_request.head.sha

const comments = await listIssueComments(token, owner, repo, pr)
const markers = parseMarkers(comments.map((c) => c.body))

if (markers.some((m) => m.stage === 'review-requested' && m.sha === sha)) {
  console.log(`Codex review already requested for PR #${pr} at ${sha}. Skipping (dedup).`)
  process.exit(0)
}

const marker = buildMarker({ stage: 'review-requested', pr, sha })
await createIssueComment(token, owner, repo, pr, `@codex review\n\n${marker}`)
console.log(`Requested Codex review for PR #${pr} at ${sha}.`)
