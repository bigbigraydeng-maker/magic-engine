/**
 * Workflow B entrypoint (ops-codex-to-claude-fix.yml). Runs when Codex
 * submits a review on a qualifying PR. Decides one of:
 *
 *   dispatch-fix  -> the workflow invokes claude-code-action directly with
 *                    the aggregated findings as its prompt, then a separate
 *                    step (mark-fix-outcome.mjs) records success/failure
 *   needs-human   -> post "NEEDS HUMAN REVIEW" and stop (round budget used up)
 *   ready         -> no actionable findings, CI green: evaluate delivery
 *                    quality (quality.mjs) and post READY FOR PRODUCT OWNER
 *                    or BLOCKED — see the `case 'ready'` handler below
 *   wait-ci       -> no actionable findings, and required CI still hasn't
 *                    gone green after polling within this run
 *   skip          -> this head sha already has a marker for the stage we'd write
 *
 * It never merges, deploys, applies a migration, or resolves a review thread.
 * `plan.mjs` holds the dispatch/round-cap decision logic and is unit-tested
 * in isolation; this file is the I/O glue around it.
 *
 * Round budget (ME2-OPS03 PR2): replaces the flat `MAX_ROUNDS = 3` with
 * `maxRoundsForRisk(risk)` (A=2, B=1, C=1), where `risk` is read off the
 * current trusted `me-dev-gate` marker — the same one `request-review.mjs`
 * posts on every push. No current trusted marker for this exact head (should
 * not happen in normal operation, since rating runs on every push before a
 * review can land, but a marker can be missing, stale, or untrusted) means
 * `risk` is `undefined`, and `maxRoundsForRisk` gives that the smallest
 * budget rather than the largest — fail closed, an unrated PR must not buy
 * more unattended pushes than a known-A one gets.
 */
import { readFileSync } from 'node:fs'
import {
  createIssueComment,
  getPullRequest,
  listCheckRunsForRef,
  listIssueComments,
  listReviewComments,
} from './github.mjs'
import { buildMarker, parseMarkers } from './markers.mjs'
import { decideStage } from './plan.mjs'
import { setOutput } from './output.mjs'
import { buildFixPrompt } from './prompt.mjs'
import { waitForRequiredCheck } from './poll.mjs'
import { isActionable } from './severity.mjs'
import { maxRoundsForRisk } from './risk.mjs'
import { findGateFor, selectTrustedGateMarkers } from './gate-marker.mjs'
import { buildVerdictComment } from './verdict.mjs'
import { TRUSTED_GATE_AUTHORS } from './trust.mjs'

// Matches the job name in ai-orchestrator-ci.yml ("ai-orchestrator-tests") or
// the workflow name shown in the Checks tab ("ai-orchestrator CI") — whichever
// GitHub surfaces as the check-run `name`.
const REQUIRED_CHECK_NAME_PATTERN = /ai-orchestrator/i
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// Overridable so the CI-wait path is testable without really waiting four
// minutes. Defaults are the production values; nothing in the workflow sets
// these. Without them the "required check never reported" branch cannot be
// covered at all, which is how it shipped with a misleading message.
const POLL_ATTEMPTS = Number(process.env.OPS_POLL_ATTEMPTS ?? 12)
const POLL_INTERVAL_MS = Number(process.env.OPS_POLL_INTERVAL_MS ?? 20000)

const token = process.env.GITHUB_TOKEN
// Codex finding (PR #1211, P1): see request-review.mjs's identical constant
// for why a marker's author login alone is not sufficient provenance.
const gateSecret = process.env.OPS_GATE_MARKER_SECRET || null
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const eventHeadSha = event.pull_request.head.sha
const base = event.pull_request.base.sha
const prBody = event.pull_request.body ?? ''
const review = event.review

function checkSucceeded(run) {
  return run?.status === 'completed' && run?.conclusion === 'success'
}

/**
 * Everything that happens once a review is confirmed to describe the commit
 * it claims to. `sha` is `review.commit_id`, never `pull_request.head.sha`
 * directly — see the entry check below for why.
 */
async function handleFreshReview(sha) {
  const [issueComments, reviewComments, initialCheckRuns] = await Promise.all([
    listIssueComments(token, owner, repo, pr),
    listReviewComments(token, owner, repo, pr, review.id),
    listCheckRunsForRef(token, owner, repo, sha),
  ])

  const markers = parseMarkers(issueComments.map((c) => c.body))

// The risk this PR is rated at, from the same trusted-marker mechanism
// request-review.mjs writes to. Bound to THIS exact head — a rating for an
// older sha does not count (`isGateCurrent`).
const trustedGates = selectTrustedGateMarkers({
  sources: issueComments.map((c) => ({ author: c.user?.login ?? null, body: c.body })),
  trustedAuthors: TRUSTED_GATE_AUTHORS,
  secret: gateSecret,
})
const currentGate = findGateFor({ markers: trustedGates, base, head: sha })
const risk = currentGate?.risk
const MAX_ROUNDS = maxRoundsForRisk(risk)

const findingCandidates = [
  { source: 'review summary', body: review.body ?? '' },
  ...reviewComments.map((c) => ({ source: `${c.path}:${c.line ?? c.original_line ?? '?'}`, body: c.body ?? '' })),
]
const actionableFindings = findingCandidates.filter((f) => isActionable(f.body))
const hasActionableFindings = actionableFindings.length > 0

let requiredCheck = initialCheckRuns.find((run) => REQUIRED_CHECK_NAME_PATTERN.test(run.name))
// The freshest full list we have. Reporting from the pre-poll snapshot
// describes the world as it was up to four minutes ago.
let latestCheckRuns = initialCheckRuns

// Codex finding (PR #906, P2): a clean review that lands while required CI is
// still running used to fall straight through to `wait-ci` and stop there —
// this workflow only fires on pull_request_review.submitted, so CI turning
// green afterward never got re-evaluated for that head sha. Poll within this
// same run (bounded) before giving up, since there is no other event wired to
// retry it.
// After the poll below, `requiredCheck` is set whenever the check was ever
// observed — completed or not — so its emptiness alone distinguishes "never
// appeared" from "appeared but unfinished". An extra `everSeen` flag was tried
// here and removed: it was a second copy of the same fact, and a second copy
// is a thing that can drift.
if (!hasActionableFindings && !checkSucceeded(requiredCheck)) {
  const polled = await waitForRequiredCheck({
    fetchCheckRuns: async () => listCheckRunsForRef(token, owner, repo, sha),
    sleep,
    pattern: REQUIRED_CHECK_NAME_PATTERN,
    maxAttempts: POLL_ATTEMPTS,
    intervalMs: POLL_INTERVAL_MS,
  })
  if (polled.check) {
    requiredCheck = polled.check
  }
  if (polled.runs) {
    latestCheckRuns = polled.runs
  }
}

const ciSuccess = checkSucceeded(requiredCheck)

// Fail closed against a head that moved since `sha` (review.commit_id) was
// reviewed. One fresh fetch, taken as late as possible — after the CI poll
// above, which can itself run for several minutes — so it also catches a
// push that landed *during* this very run, not just before it. `isStale`
// still feeds `decideStage` so the dispatch path keeps its existing
// "skip without consuming a round" behaviour; the check below extends the
// same guarantee to needs-human / wait-ci / ready, none of which decideStage
// gates on staleness (see plan.mjs — isStale only matters when there are
// actionable findings).
const isStale = (await getPullRequest(token, owner, repo, pr)).head.sha !== sha

const plan = decideStage({
  markers,
  sha,
  hasActionableFindings,
  isStale,
  ciSuccess,
  maxRounds: MAX_ROUNDS,
})

if (isStale && plan.action !== 'skip') {
  console.log(
    `PR #${pr}: head moved past ${sha} (the reviewed commit) before this run could write its conclusion — skipping ${plan.action} without consuming a round.`,
  )
  setOutput('action', 'skip')
  return
}

switch (plan.action) {
  case 'skip': {
    console.log(`Skipping: ${plan.reason}`)
    setOutput('action', 'skip')
    break
  }
  case 'needs-human': {
    const marker = buildMarker({ stage: 'needs-human', pr, sha, round: plan.round })
    await createIssueComment(
      token,
      owner,
      repo,
      pr,
      `**NEEDS HUMAN REVIEW**\n\nCodex has raised actionable findings for ${MAX_ROUNDS} automated fix round(s) (risk level ${risk ?? 'unknown'}) without a clean review. Stopping automation here — please review manually.\n\n${marker}`
    )
    setOutput('action', 'needs-human')
    break
  }
  case 'wait-ci': {
    // This used to log and post nothing. Nothing else re-triggers this
    // workflow for the same sha — it only listens to
    // pull_request_review.submitted — so re-running a check to green produces
    // no new event, and the PR simply stopped moving. From the PR page, "CI is
    // red" and "the automation is broken" looked identical: silence, forever.
    //
    // Say which checks are not green, once per sha, and say plainly that a
    // re-run alone will not restart anything.
    // Two Codex findings (PR #943, both P2) shaped this block:
    //
    //  - The gate is `checkSucceeded` = completed + success. This listing used
    //    a *looser* rule (it also let `neutral` and `skipped` through), so a
    //    required check that ended `skipped` was filtered out as "green" and
    //    the comment then said "no check runs reported at all" — hiding the
    //    very thing that blocked the PR. A report must use the gate's own
    //    standard or it describes a different system.
    //
    //  - When the required check never reports at all, listing the other
    //    failing checks reads as if THOSE are the blocker. Maintainers then
    //    fix the wrong thing and the PR still will not move. Absence is its
    //    own diagnosis and has to be stated as one.
    const isGreenByGate = (r) => checkSucceeded(r)
    // Codex finding (PR #943, P2): the previous version reported from the
    // PRE-poll snapshot and removed the required check's duplicate with
    // `r !== requiredCheck` — a reference comparison against a freshly
    // deserialised object, which never matched. The comment listed that check
    // twice, in two contradictory states, alongside four-minute-old data for
    // everything else.
    //
    // Reporting from the single freshest list fixes both at once: it is the
    // world as it is now, and the required check appears in it exactly once.
    // An id-based dedupe was written here as well and then removed — with one
    // list there is nothing to deduplicate, and a guard that cannot be reached
    // is a guard that cannot be tested.
    const notGreen = latestCheckRuns
      .filter((r) => !isGreenByGate(r))
      .map((r) => `- \`${r.name}\` — ${r.status}${r.conclusion ? `/${r.conclusion}` : ''}`)
    // Three genuinely different states, three different things for a human to
    // do. Codex finding (PR #943, P2): the previous version collapsed the
    // first two, so a normal slow-starting check was announced as "never
    // reported" — a confident wrong diagnosis, which is worse than silence
    // because it sends someone to fix the wrong thing.
    const blocker = !requiredCheck
      ? `The required check (matching \`${REQUIRED_CHECK_NAME_PATTERN}\`) **never appeared on this commit** — that, not the list below, is what is holding this PR. Check that the workflow producing it is actually triggering.`
      : requiredCheck?.status !== 'completed'
        ? `The required check \`${requiredCheck?.name}\` appeared but was still \`${requiredCheck?.status}\` when this run gave up waiting. It may well go green on its own — but nothing will re-evaluate this PR when it does.`
        : `The required check \`${requiredCheck?.name}\` finished \`${requiredCheck?.conclusion}\`.`
    const others = notGreen.length
      ? `\n\nChecks on \`${sha.slice(0, 10)}\` that are not completed+success:\n\n${notGreen.join('\n')}`
      : `\n\nEvery other check on \`${sha.slice(0, 10)}\` is completed and successful.`
    const alreadyTold = markers.some((m) => m.stage === 'ci-blocked' && m.sha === sha)
    if (!alreadyTold) {
      const marker = buildMarker({ stage: 'ci-blocked', pr, sha })
      await createIssueComment(
        token,
        owner,
        repo,
        pr,
        `**BLOCKED ON CI**\n\nCodex raised no actionable findings, but this PR cannot advance.\n\n${blocker}${others}\n\nNothing re-triggers this automation for the same commit, so re-running a check to green will **not** move this PR on its own — push a commit, or ask Codex to review again once CI is green.\n\n${marker}`
      )
    }
    console.log('No actionable findings, but CI is not green — posted BLOCKED ON CI instead of staying silent.')
    setOutput('action', 'wait-ci')
    break
  }
  case 'ready': {
    // ME2-OPS03 PR2: no actionable Codex findings and required CI is green is
    // no longer enough on its own to say READY. Score delivery quality
    // (quality.mjs, via the shared verdict.mjs) and run the hard gates — the
    // same wiring recheck-readiness.mjs uses for the unsampled-C path — and
    // post whichever of READY FOR PRODUCT OWNER / BLOCKED the evidence
    // actually supports. A missing/stale trusted gate marker (`risk` is
    // `undefined`, `currentGate` is falsy) is not special-cased away here —
    // it flows into `shaMatches: false`, which is itself a hard-gate blocker.
    const { decision, comment } = await buildVerdictComment({
      token,
      owner,
      repo,
      prNumber: pr,
      prBody,
      base,
      sha,
      risk: risk ?? null,
      shaMatches: Boolean(currentGate),
      checkRuns: latestCheckRuns,
      requiredCiPassed: ciSuccess,
      openBlockerCount: actionableFindings.length,
      secret: gateSecret,
    })
    // Terminal for this sha either way (READY or BLOCKED): a future push
    // creates a new sha and this whole evaluation runs fresh. Reusing the
    // 'ready' stage name for both outcomes keeps plan.mjs's dedup
    // (`hasMarkerForSha('ready')`) untouched — that marker means "a readiness
    // verdict was posted for this sha", not literally "approved". It is a
    // different marker family from the `me-dev-gate` one `buildVerdictComment`
    // already embeds (that one carries the score/decision payload; this one is
    // what plan.mjs's dedup actually parses), so both are appended below.
    const stageMarker = buildMarker({ stage: 'ready', pr, sha })
    await createIssueComment(token, owner, repo, pr, `${comment}\n${stageMarker}`)
    setOutput('action', decision.decision === 'READY_FOR_PRODUCT_OWNER' ? 'ready' : 'blocked')
    break
  }
  case 'dispatch-fix': {
    // Codex finding (PR #906, P2): this case used to post the fix-dispatched
    // marker itself, before the Claude Action step even ran — so a timeout or
    // failed push still permanently consumed a round. The marker is now
    // posted by mark-fix-outcome.mjs, and only on success.
    const findingsText = actionableFindings
      .map((f, i) => `${i + 1}. [${f.source}]\n${f.body.trim()}`)
      .join('\n\n')
    // The findings block is attacker-influenced text: anyone who can get words
    // into a Codex review body gets those words into a prompt for a run that
    // commits and pushes. Issue #939 required this surface be re-checked
    // before the Codex bot was allowlisted on the action — the fencing and its
    // adversarial tests live in ./prompt.mjs (a script cannot be imported by a
    // test without executing, hence the separate module).
    const prompt = buildFixPrompt({
      round: plan.round,
      maxRounds: MAX_ROUNDS,
      pr,
      findingsText,
    })
    setOutput('action', 'dispatch-fix')
    setOutput('round', String(plan.round))
    setOutput('prompt', prompt)
    break
  }
  default:
    throw new Error(`Unhandled plan action: ${plan.action}`)
}
}

// GitHub's review payload carries the commit Codex actually reviewed in
// `review.commit_id` — not `pull_request.head.sha`, which reflects the PR's
// head at event-delivery time and can already be newer than what Codex saw
// if a push landed while the review was in flight or queued for delivery.
// Trusting the delivered head here would let an already-stale review drive
// a head sha Codex never looked at.
//
// Fail closed in two places, not one:
//   1. Here, at entry: `commit_id` must exist and must already match this
//      same event's head. A mismatch here means the review was stale the
//      moment GitHub delivered it — do nothing, no round consumed.
//   2. Inside `handleFreshReview`, right before any write (`isStale`,
//      re-checked against a FRESH fetch) — because that function's own CI
//      poll can itself run for several minutes, its own window for a push
//      to land in.
const reviewedSha = typeof review?.commit_id === 'string' ? review.commit_id : null
if (!reviewedSha || reviewedSha !== eventHeadSha) {
  console.log(
    `PR #${pr}: review.commit_id (${reviewedSha ?? 'missing'}) does not match the event's head sha (${eventHeadSha}) — this review was already stale on delivery. Skipping without writing anything or consuming a round.`,
  )
  setOutput('action', 'skip')
} else {
  await handleFreshReview(reviewedSha)
}
