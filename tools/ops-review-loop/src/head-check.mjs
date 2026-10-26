import { pathToFileURL } from 'node:url'

/**
 * Where a Risk gate verdict is recorded.
 *
 * `pull_request` and `pull_request_target` already attach the job named
 * "Risk gate" to the pull request head. That job's exit code is the verdict.
 *
 * Any other event (`issue_comment`, and anything added later that is not a
 * pull request event) runs in the default branch context. GitHub then records
 * the job on the default-branch SHA, which is not the commit the ruleset
 * reads. Those runs publish a check run named "Risk gate" onto the PR head
 * through the Checks API, and the job itself must exit 0 after that publish:
 * a failing job would paint the default branch red with a verdict that is not
 * about that commit. Failing to publish still exits 1 — a missing check is
 * not a pass.
 *
 * The check name is the ruleset string. It must stay identical to the
 * `pull_request_target` job name.
 */

export const RISK_GATE_CHECK_NAME = 'Risk gate'

/** Events whose Actions job is already the required check on the PR head. */
const HEAD_BOUND_EVENTS = new Set(['pull_request', 'pull_request_target'])

/** GitHub rejects a check summary longer than this. */
const CHECK_SUMMARY_MAX = 65000

const HEAD_SHA_RE = /^[0-9a-f]{40}$/i

/**
 * True when this run's own job is not the check the ruleset reads, so the
 * verdict has to be written onto the PR head explicitly.
 *
 * An empty event fails closed: it is treated as the head-bound job, whose
 * exit code must still be red when the gate did not pass. Guessing "publish
 * and exit 0" would turn that job green.
 *
 * @param {unknown} eventName
 * @returns {boolean}
 */
export function shouldPublishHeadCheck(eventName) {
  return typeof eventName === 'string' && eventName !== '' && !HEAD_BOUND_EVENTS.has(eventName)
}

/**
 * Process exit code for the gate job.
 *
 * Head-bound events: 0 only when the gate passed. Republish events: 0 when
 * the head check was written (pass or fail), 1 when it was not.
 *
 * A draft is the one exception: a draft PR cannot be merged and auto-merge is
 * already switched off for it, so a red cross says nothing true. Only an
 * explicit `draft === true` counts; a missing or malformed value stays red.
 *
 * @param {{eventName?: unknown, pass?: unknown, headCheckPublished?: unknown, draft?: unknown}} input
 * @returns {0|1}
 */
export function gateJobExitCode({ eventName, pass, headCheckPublished, draft } = {}) {
  if (shouldPublishHeadCheck(eventName)) return headCheckPublished === true ? 0 : 1
  if (draft === true) return 0
  return pass === true ? 0 : 1
}

/**
 * Body for `POST /repos/{owner}/{repo}/check-runs`.
 *
 * `failure` is deliberate. `neutral` and `skipped` do not keep an unreviewed
 * head red under every ruleset — so `neutral` is used only for a draft
 * (explicit `draft === true`), which cannot merge anyway. A pass is never
 * neutral, and a non-draft failure is always `failure`.
 *
 * @param {{headSha?: unknown, pass?: unknown, summary?: unknown, now?: unknown, detailsUrl?: unknown, draft?: unknown}} input
 * @returns {{name: string, head_sha: string, status: 'completed', conclusion: 'success'|'failure'|'neutral', started_at: string, completed_at: string, output: {title: string, summary: string}, details_url?: string}}
 */
export function buildRiskGateCheckRun({ headSha, pass, summary, now, detailsUrl, draft } = {}) {
  if (typeof headSha !== 'string' || !HEAD_SHA_RE.test(headSha)) {
    throw new Error('refuse to publish Risk gate without a full head sha')
  }
  if (typeof now !== 'string' || now === '') {
    throw new Error('refuse to publish Risk gate without a timestamp')
  }
  const conclusion = pass === true ? 'success' : draft === true ? 'neutral' : 'failure'
  const text =
    typeof summary === 'string' && summary.trim() !== '' ? summary : conclusion === 'success' ? '通过' : '没通过'
  /** @type {{name: string, head_sha: string, status: 'completed', conclusion: 'success'|'failure'|'neutral', started_at: string, completed_at: string, output: {title: string, summary: string}, details_url?: string}} */
  const body = {
    name: RISK_GATE_CHECK_NAME,
    head_sha: headSha,
    status: 'completed',
    conclusion,
    started_at: now,
    completed_at: now,
    output: { title: RISK_GATE_CHECK_NAME, summary: text.slice(0, CHECK_SUMMARY_MAX) },
  }
  if (typeof detailsUrl === 'string' && detailsUrl !== '') body.details_url = detailsUrl
  return body
}

/**
 * Whether this run may turn auto-merge on.
 *
 * A comment re-check and a new push do not cancel each other. The re-check
 * can already have decided "enable" for the head it reviewed. Enabling is
 * allowed only when the live head is still that same full SHA. The returned
 * arguments include `--match-head-commit` so a push between this read and
 * `gh pr merge` cannot enable either.
 *
 * @param {{boundHead?: unknown, liveHead?: unknown}} input
 * @returns {{enable: boolean, args: string[]}}
 */
export function planAutoMergeEnable({ boundHead, liveHead } = {}) {
  const bound = typeof boundHead === 'string' ? boundHead.toLowerCase() : ''
  const live = typeof liveHead === 'string' ? liveHead.toLowerCase() : ''
  if (!HEAD_SHA_RE.test(bound) || bound !== live) return { enable: false, args: [] }
  return {
    enable: true,
    args: ['pr', 'merge', '--auto', '--merge', '--match-head-commit', bound],
  }
}

const entry = process.argv[1]
const invokedDirectly = typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href
if (invokedDirectly && process.argv.includes('--plan-auto-merge')) {
  const plan = planAutoMergeEnable({
    boundHead: process.env.HEAD_SHA,
    liveHead: process.env.LIVE_HEAD,
  })
  process.stdout.write(plan.enable === true ? 'enable\n' : 'skip\n')
}
