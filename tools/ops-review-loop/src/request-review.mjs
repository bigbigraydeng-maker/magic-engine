/**
 * Workflow A entrypoint (ops-codex-request-review.yml). Runs on every push to
 * a qualifying PR. Two things happen here, in order, per ME2-OPS03 PR2:
 *
 *   1. Rate the PR (`risk.mjs`, from its actual changed files — both ends of
 *      a rename) and post the rating, once per base+head pair: human text
 *      plus a hidden `me-dev-gate` marker (`gate-marker.mjs`). Idempotent —
 *      if a trusted marker already covers this exact base/head, nothing is
 *      re-posted.
 *   2. Decide whether this head still needs a Codex review (`sampling.mjs`:
 *      A and B always, C by a stable 20% sample) and, if so, post "@codex
 *      review" exactly once per head sha — unchanged from before this PR.
 *
 * Never merges, never deploys, never touches production.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, getPullRequest, listCheckRunsForRef, listIssueComments, listPullRequestFiles } from './github.mjs'
import { buildMarker, parseMarkers } from './markers.mjs'
import { classifyRisk, parseDeclaredRisk } from './risk.mjs'
import { shouldRequestCodexReview } from './sampling.mjs'
import { findGateFor, selectTrustedGateMarkers } from './gate-marker.mjs'
import { buildRatingComment } from './report.mjs'
import { buildVerdictComment, SCOPE_GUARD_CHECK_NAME_PATTERN } from './verdict.mjs'
import { TRUSTED_GATE_AUTHORS } from './trust.mjs'

// Matches the job name in ai-orchestrator-ci.yml or the workflow name shown
// in the Checks tab — whichever GitHub surfaces as the check-run `name`.
// Same pattern handle-review.mjs and recheck-readiness.mjs use.
const REQUIRED_CHECK_NAME_PATTERN = /ai-orchestrator/i

// Two tokens on purpose, split by what each one is actually for.
//
// Only the @codex review POST needs the Product Owner's identity — Codex
// ignores github-actions[bot] (see the workflow file for the production
// evidence). Everything else — dedup reads, and posting the rating itself —
// uses the ambient GITHUB_TOKEN: the rating must be authored by the identity
// TRUSTED_GATE_AUTHORS actually trusts, and that identity is
// github-actions[bot], not the human behind OPS_REVIEW_PAT.
const readToken = process.env.GITHUB_TOKEN
const postToken = process.env.REVIEW_REQUEST_TOKEN
// Codex finding (PR #1211, P1): `github-actions[bot]` alone does not prove a
// marker came from THIS control plane — see trust.mjs / gate-marker.mjs for
// the full reasoning. Unset until the pending OPS_GATE_MARKER_SECRET
// workflow wiring is applied, which reproduces this script's pre-existing
// author-only behaviour exactly; set, it is enforced end to end.
const gateSecret = process.env.OPS_GATE_MARKER_SECRET || null
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const sha = event.pull_request.head.sha
const base = event.pull_request.base.sha
const prBody = event.pull_request.body ?? ''

const comments = await listIssueComments(readToken, owner, repo, pr)
const markers = parseMarkers(comments.map((c) => c.body))

// Codex finding (PR #1211, P1): the concurrency group above only serialises
// runs for the SAME head sha. Two pushes to the same PR in quick succession
// (old sha, new sha) get two different groups and can run concurrently — and
// `listPullRequestFiles`/`listCheckRunsForRef` are not scoped to a historical
// sha, they describe the PR's CURRENT state. A delayed run for an old event
// could therefore rate or verdict the OLD sha using the NEW diff. Re-checked
// as late as possible before every write below; any mismatch is fail-closed —
// skip without writing, since the event for the new head (already delivered,
// or about to be) is the one that owns rating/verdicting it.
async function isCurrentHead() {
  const current = await getPullRequest(readToken, owner, repo, pr)
  return current?.head?.sha === sha
}

// --- Step 1: rate the PR, unless a trusted rating for this exact base/head
// is already on record. ---
const trustedGates = selectTrustedGateMarkers({
  sources: comments.map((c) => ({ author: c.user?.login ?? null, body: c.body })),
  trustedAuthors: TRUSTED_GATE_AUTHORS,
  secret: gateSecret,
})
const currentGate = findGateFor({ markers: trustedGates, base, head: sha })

let risk
// True once this event is known to be stale (head moved past `sha`) — set the
// first time a freshness check fails, and checked before every later step so
// one stale event cannot rate step 1, then also act on step 2 with a `risk`
// that came from a diff that may no longer describe `sha`.
let stale = false
if (currentGate) {
  risk = currentGate.risk
  console.log(`Gate marker already current for ${base.slice(0, 10)}..${sha.slice(0, 10)}: ${risk}. Not re-posting.`)
} else if (!(await isCurrentHead())) {
  stale = true
  console.log(
    `PR #${pr}: head moved past ${sha} before its changed files could be read — skipping this stale event entirely (the event for the new head will rate it).`,
  )
} else {
  let files = null
  try {
    files = await listPullRequestFiles(readToken, owner, repo, pr)
  } catch (err) {
    // classifyRisk treats a non-array files list as unreadable and rates A —
    // exactly the fail-closed behaviour a broken fetch must produce.
    console.log(`Could not read changed files for PR #${pr}: ${err.message}`)
  }
  const declaredRisk = parseDeclaredRisk(prBody)
  const rated = classifyRisk({ files, declaredRisk })
  risk = rated.risk
  const comment = buildRatingComment({
    risk: rated.risk,
    computedRisk: rated.computedRisk,
    declaredRisk: rated.declaredRisk,
    readable: rated.readable,
    reasons: rated.reasons,
    base,
    head: sha,
    secret: gateSecret,
  })
  if (!(await isCurrentHead())) {
    stale = true
    console.log(
      `PR #${pr}: head moved past ${sha} while its changed files were being read — discarding this rating instead of posting it for a diff that may no longer describe ${sha}.`,
    )
  } else {
    await createIssueComment(readToken, owner, repo, pr, comment)
    console.log(`Rated PR #${pr} at ${base.slice(0, 10)}..${sha.slice(0, 10)}: ${risk}.`)
  }
}

// --- Step 2: decide whether this head still needs a Codex review. ---
// Plain if/else rather than an early `process.exit(0)` (the original shape):
// nothing runs after this block anyway, and avoiding process.exit keeps this
// script importable by a test in the same process — the same reason
// recheck-readiness.mjs was written this way from the start.
if (stale) {
  console.log(`PR #${pr}: skipping the Codex-review / readiness step for ${sha} too — this event is stale.`)
} else if (markers.some((m) => m.stage === 'review-requested' && m.sha === sha)) {
  console.log(`Codex review already requested for PR #${pr} at ${sha}. Skipping (dedup).`)
} else {
  const { review, reason } = shouldRequestCodexReview({ risk, pr, sha })
  if (review) {
    console.log(`Requesting Codex review for PR #${pr} at ${sha}: ${reason}`)
    if (!(await isCurrentHead())) {
      console.log(`PR #${pr}: head moved past ${sha} before the Codex review request could be posted — skipping.`)
    } else {
      const marker = buildMarker({ stage: 'review-requested', pr, sha })
      // The one call that must carry the Product Owner's identity.
      await createIssueComment(postToken, owner, repo, pr, `@codex review\n\n${marker}`)
      console.log(`Requested Codex review for PR #${pr} at ${sha}.`)
    }
  } else {
    console.log(`Not requesting Codex review for PR #${pr} at ${sha}: ${reason}`)
    // ops-dev-gate-recheck.yml is the normal path that evaluates this case,
    // triggered when required CI finishes. But CI can finish before this very
    // push event's rating step above ever runs (both are triggered by the
    // same `pull_request` event, racing each other) — and that recheck leg
    // backs off with "no current trusted rating yet" when it loses that race,
    // with nothing left to re-trigger it once CI has already gone green. So:
    // if CI already happened to be green by the time this step runs, evaluate
    // readiness right here instead of leaving it to a workflow_run event that
    // may never come. This job and ops-dev-gate-recheck.yml's job share one
    // concurrency group per head sha (`ops-dev-gate-<sha>`, see both workflow
    // files), so only one of the two can be writing at a time — whichever
    // runs second sees the `decision` already on the gate marker and no-ops
    // (same dedup buildVerdictComment/recheck-readiness.mjs already rely on)
    // — checked explicitly here too, since a re-run of this exact step must
    // not post a second verdict for a sha that already has one.
    const alreadyDecided = Boolean(currentGate) && 'decision' in currentGate
    const checkRuns = alreadyDecided ? [] : await listCheckRunsForRef(readToken, owner, repo, sha)
    const requiredCheck = checkRuns.find((run) => REQUIRED_CHECK_NAME_PATTERN.test(run.name))
    const scopeGuardCheck = checkRuns.find((run) => SCOPE_GUARD_CHECK_NAME_PATTERN.test(run.name))
    const requiredCiPassed = requiredCheck?.status === 'completed' && requiredCheck?.conclusion === 'success'
    // Codex finding (PR #1211, P2): ops-fix-scope-guard scores its own
    // `scope-guard-green` point in the same verdict `buildVerdictComment`
    // computes below, and its workflow races the required CI's on this same
    // `pull_request` event. Required CI already being green does not mean
    // the scope guard has finished too — locking in a verdict here while it
    // is still `queued`/`in_progress` can silently lose that point and post
    // a wrongly-BLOCKED verdict that then dedupes forever.
    const scopeGuardFinished = scopeGuardCheck?.status === 'completed'
    if (alreadyDecided) {
      console.log(`PR #${pr}: ${sha} already has a readiness decision on record. Skipping (dedup).`)
    } else if (requiredCiPassed && scopeGuardFinished) {
      if (!(await isCurrentHead())) {
        console.log(`PR #${pr}: head moved past ${sha} before the readiness verdict could be posted — skipping.`)
      } else {
        const { decision, comment } = await buildVerdictComment({
          token: readToken,
          owner,
          repo,
          prNumber: pr,
          prBody,
          base,
          sha,
          risk,
          shaMatches: true,
          checkRuns,
          requiredCiPassed,
          openBlockerCount: 0,
          secret: gateSecret,
        })
        await createIssueComment(readToken, owner, repo, pr, comment)
        console.log(
          `Posted ${decision.decision} for PR #${pr} at ${sha} (unsampled C; required CI ${requiredCheck.conclusion}, scope guard ${scopeGuardCheck.conclusion} at rating time).`,
        )
      }
    } else if (requiredCiPassed && !scopeGuardFinished) {
      // Leave it to ops-dev-gate-recheck.yml, which now also listens for
      // ops-fix-scope-guard's own workflow completing (see
      // recheck-readiness.mjs) — that gives this PR a deterministic future
      // event once the scope guard actually finishes, instead of this leg
      // guessing at an incomplete score.
      console.log(
        `PR #${pr}: ${sha} required CI is already green, but ops-fix-scope-guard has not completed yet (${scopeGuardCheck?.status ?? 'not seen'}) — leaving the readiness verdict to ops-dev-gate-recheck.yml.`,
      )
    }
  }
}
