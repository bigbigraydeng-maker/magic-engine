/**
 * Workflow B entrypoint (ops-codex-to-claude-fix.yml). Runs when Codex
 * submits a review on a qualifying PR. Decides one of:
 *
 *   dispatch-fix  -> the workflow invokes claude-code-action directly with
 *                    the aggregated findings as its prompt, then a separate
 *                    step (mark-fix-outcome.mjs) records success/failure
 *   needs-human   -> post "NEEDS HUMAN REVIEW" and stop (3 rounds already used)
 *   ready         -> post "READY FOR PRODUCT OWNER" (no actionable findings, CI green)
 *   wait-ci       -> no actionable findings, and required CI still hasn't
 *                    gone green after polling within this run
 *   skip          -> this head sha already has a marker for the stage we'd write
 *
 * It never merges, deploys, applies a migration, or resolves a review thread.
 * `plan.mjs` holds the actual decision logic and is unit-tested in isolation;
 * this file is the I/O glue around it.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, getPullRequest, listCheckRunsForRef, listIssueComments, listPullRequestFiles, listReviewComments } from './github.mjs'
import { buildMarker, parseMarkers } from './markers.mjs'
import { decideStage } from './plan.mjs'
import { setOutput } from './output.mjs'
import { buildFixPrompt } from './prompt.mjs'
import { waitForRequiredCheck } from './poll.mjs'
import { classifyRisk, readDeclaredRisk } from './risk.mjs'
import { isActionable } from './severity.mjs'

const MAX_ROUNDS = 3
// Matches the check name published by pr-light-checks.yml ("ai-orchestrator-tests").
// GitHub surfaces that string as the check-run `name`.
const REQUIRED_CHECK_NAME_PATTERN = /ai-orchestrator/i
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// Overridable so the CI-wait path is testable without really waiting four
// minutes. Defaults are the production values; nothing in the workflow sets
// these. Without them the "required check never reported" branch cannot be
// covered at all, which is how it shipped with a misleading message.
const POLL_ATTEMPTS = Number(process.env.OPS_POLL_ATTEMPTS ?? 12)
const POLL_INTERVAL_MS = Number(process.env.OPS_POLL_INTERVAL_MS ?? 20000)

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const sha = event.pull_request.head.sha
const review = event.review

const [issueComments, reviewComments, initialCheckRuns] = await Promise.all([
  listIssueComments(token, owner, repo, pr),
  listReviewComments(token, owner, repo, pr, review.id),
  listCheckRunsForRef(token, owner, repo, sha),
])

const markers = parseMarkers(issueComments.map((c) => c.body))

const findingCandidates = [
  { source: 'review summary', body: review.body ?? '' },
  ...reviewComments.map((c) => ({ source: `${c.path}:${c.line ?? c.original_line ?? '?'}`, body: c.body ?? '' })),
]
const actionableFindings = findingCandidates.filter((f) => isActionable(f.body))
const hasActionableFindings = actionableFindings.length > 0

// Concurrency guard for the dispatch path only (the only path that pushes).
// The auto-fix leg used to stay pinned to the narrow `claude/me2-*` lane
// specifically so it would never land on a branch a live window was holding
// (CLAUDE.md §6, one window per branch). Now that it shares the same
// `claude/*` scope as the review-request leg, this re-fetch is what stands
// in for that: if the PR's head has moved past the sha Codex reviewed by the
// time this job actually runs, someone pushed while the review was in
// flight, and dispatching now would push a fix for code that is no longer
// current. Only worth the extra API call when there is something to dispatch.
const isStale = hasActionableFindings ? (await getPullRequest(token, owner, repo, pr)).head.sha !== sha : false

function checkSucceeded(run) {
  return run?.status === 'completed' && run?.conclusion === 'success'
}

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

const plan = decideStage({
  markers,
  sha,
  hasActionableFindings,
  isStale,
  ciSuccess,
  maxRounds: MAX_ROUNDS,
})

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
      `**NEEDS HUMAN REVIEW**\n\nCodex has raised actionable findings for ${MAX_ROUNDS} automated fix rounds without a clean review. Stopping automation here — please review manually.\n\n${marker}`
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
    const marker = buildMarker({ stage: 'ready', pr, sha })
    await createIssueComment(
      token,
      owner,
      repo,
      pr,
      `**READY FOR PRODUCT OWNER**\n\nCodex reports no actionable P0/P1/P2 findings and required CI is green. This automation never merges — a human must take it from here.\n\n${marker}`
    )
    setOutput('action', 'ready')
    break
  }
  case 'dispatch-fix': {
    // --- Risk gate: A-level PRs must not receive automated pushes ----------
    // Incident #2131: the bot pushed after 子牙 signed off, silently replacing
    // the reviewed code. The fix: compute the risk grade the same way the
    // merge gate does (classifyRisk + declared floor) and refuse to push when
    // the grade is A or unreadable.
    let riskGrade = 'A'
    let riskError = null
    let riskReasons = []
    let gradedHead = null
    try {
      const prData = await getPullRequest(token, owner, repo, pr)
      gradedHead = prData?.head?.sha ?? null
      const prBody = typeof prData?.body === 'string' ? prData.body : ''
      const declared = readDeclaredRisk(prBody)
      const files = await listPullRequestFiles(token, owner, repo, pr)
      const rating = classifyRisk({
        files: files.map((f) => ({
          filename: f.filename,
          status: f.status,
          previous_filename: f.previous_filename,
        })),
        declaredRisk: declared.risk,
        declaredUnreadable: declared.unreadable,
      })
      riskGrade = rating.risk
      riskReasons = rating.reasons ?? []
    } catch (err) {
      riskError = err instanceof Error ? err.message : String(err)
    }

    if (riskGrade === 'A' || riskError) {
      // Dedup: one "A-level blocked" comment per head sha is enough.
      // Without this, every Codex review on the same A-level sha posts
      // another identical comment.
      const alreadyBlocked = markers.some((m) => m.stage === 'a-level-blocked' && m.sha === sha)
      if (alreadyBlocked) {
        console.log(`A-level PR #${pr} already has a-level-blocked marker for ${sha} — not posting again`)
        setOutput('action', 'a-level-blocked')
        break
      }
      const reason = riskError
        ? `风险判定失败（${riskError}），按 A 处理`
        : riskReasons.length
          ? riskReasons.join('；')
          : '改动文件命中 A 级规则'
      const reviewLink = `https://github.com/${owner}/${repo}/pull/${pr}#pullrequestreview-${review.id}`
      const marker = buildMarker({ stage: 'a-level-blocked', pr, sha })
      await createIssueComment(
        token,
        owner,
        repo,
        pr,
        `**这是 A 级改动，自动修复不推送**\n\n${reason}。请作者自己处理这条审查意见：${reviewLink}\n\n${marker}`,
      )
      console.log(`A-level PR #${pr} — skipping auto-fix dispatch (${reason})`)
      setOutput('action', 'a-level-blocked')
      break
    }

    // --- B/C: proceed with automated fix -----------------------------------
    const findingsText = actionableFindings
      .map((f, i) => `${i + 1}. [${f.source}]\n${f.body.trim()}`)
      .join('\n\n')
    const prompt = buildFixPrompt({
      round: plan.round,
      maxRounds: MAX_ROUNDS,
      pr,
      findingsText,
    })
    setOutput('action', 'dispatch-fix')
    setOutput('round', String(plan.round))
    setOutput('prompt', prompt)
    setOutput('risk_grade', riskGrade)
    setOutput('findings_summary', actionableFindings.map((f) => f.source).join(', '))
    setOutput('review_id', String(review.id))
    if (gradedHead) setOutput('graded_head', gradedHead)
    break
  }
  default:
    throw new Error(`Unhandled plan action: ${plan.action}`)
}
