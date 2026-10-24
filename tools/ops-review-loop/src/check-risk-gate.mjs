/**
 * Required-check entrypoint for the merge gate ("Risk gate").
 *
 * Runs from a `pull_request_target` workflow that checked out `main`, so this
 * code is trusted and the PR is untrusted DATA. It never checks out or executes
 * PR code — it only reads the PR's metadata, changed files and comments through
 * the API, rates the diff with `risk.mjs`, and reports a decision.
 *
 * 🔴 **Invariant: `decision=enable` is written ONLY when
 * `decision.pass === true && decision.tier === 'auto'`.** Every other path —
 * including every failure path — writes `decision=disable`. This script never
 * calls any merge API; the workflow step reads the output and acts on it. That
 * separation is what keeps "may this land unattended" a pure function
 * (`merge-decision.mjs`) rather than a side effect buried in a job.
 *
 * 🔴 **Fail closed.** Any error while *evaluating* the gate is a failure, never
 * a pass: "we could not check" and "there was nothing wrong" must not look the
 * same. A missing required env var, an API error, or a head/base mismatch all
 * end in `decision=disable tier=blocked risk=A`. On `pull_request_target` the
 * process then exits 1, because that job *is* the required check. On any other
 * event the same failure is written onto the PR head as a "Risk gate" check
 * run and the process exits 0, so the default-branch job does not go red.
 *
 * 🔴 **Gate markers are read only from `GATE_MARKER_AUTHOR`.** A marker is a
 * verdict, and anyone who can comment on a PR can type one. The identity that
 * writes the rating is this workflow's own bot login — never the PR author's
 * login, which would let a PR author rate their own change.
 */

import { appendFileSync } from 'node:fs'

import { buildRiskGateCheckRun, gateJobExitCode, shouldPublishHeadCheck } from './head-check.mjs'
import { classifyRisk, readDeclaredRisk } from './risk.mjs'
import {
  buildGateMarker,
  findGateFor,
  parseGateMarkers,
  selectTrustedGateMarkers,
  shouldPostGateComment,
} from './gate-marker.mjs'
import { evaluateCodexHeadReview, reviewSignoffState } from './signoff-marker.mjs'
import { decideMerge, summariseDecision } from './merge-decision.mjs'
import { shouldRequestLegacySpotCheck } from './sampling.mjs'
import { applyTrialRunToDecision, describeTrialRun, evaluateTrialRunSafely } from './quality.mjs'

/**
 * The identity this workflow's `GITHUB_TOKEN` posts as, and the ONLY author
 * whose gate markers are read.
 *
 * 🔴 Never use the PR author's login here. A gate marker is a *verdict*, and a
 * PR author who can write one can rate their own change — which is exactly the
 * hole `risk.mjs` exists to close.
 */
export const GATE_MARKER_AUTHOR = 'github-actions[bot]'

const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const pr = process.env.PR_NUMBER
const baseSha = process.env.BASE_SHA
const headSha = process.env.HEAD_SHA
const prAuthor = process.env.PR_AUTHOR
const prDraft = process.env.PR_DRAFT
const prIsFork = process.env.PR_IS_FORK
const signoffTrustedLogins = process.env.SIGNOFF_TRUSTED_LOGINS ?? ''
const eventName = process.env.GATE_EVENT_NAME ?? ''

const SHA_RE = /^[0-9a-f]{40}$/i

/**
 * Write a line to the step summary and stdout, mirroring `check-fix-scope.mjs`.
 *
 * @param {string} text
 */
function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  }
  console.log(text)
}

/**
 * Append `key=value` lines to `GITHUB_OUTPUT` when it is set.
 *
 * @param {Record<string, string>} outputs
 */
function writeOutputs(outputs) {
  const path = process.env.GITHUB_OUTPUT
  if (!path) return
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`)
  appendFileSync(path, `${lines.join('\n')}\n`)
}

/**
 * Parse a tri-state boolean env var: only the exact strings `"true"` / `"false"`
 * are accepted; anything else is `undefined` so the caller fails closed.
 *
 * @param {string|undefined} value
 * @returns {boolean|undefined}
 */
function parseTriState(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/**
 * The required env vars, with a human-readable name for each.
 *
 * @returns {Array<[string, string|undefined]>}
 */
function requiredEnv() {
  return [
    ['GITHUB_TOKEN', token],
    ['GITHUB_REPOSITORY', repository],
    ['PR_NUMBER', pr],
    ['BASE_SHA', baseSha],
    ['HEAD_SHA', headSha],
    ['PR_AUTHOR', prAuthor],
    ['PR_DRAFT', prDraft],
    ['PR_IS_FORK', prIsFork],
  ]
}

/**
 * Link the head check back to this Actions run when the runner provides one.
 *
 * @returns {string|undefined}
 */
function riskGateDetailsUrl() {
  const server = process.env.GITHUB_SERVER_URL
  const runId = process.env.GITHUB_RUN_ID
  if (!server || !repository || !runId) return undefined
  return `${server}/${repository}/actions/runs/${runId}`
}

/**
 * Write the verdict onto the PR head. No-op for events whose job is already
 * that check. Throws if the publish was required and the API rejected it.
 *
 * @param {boolean} pass
 * @param {string} summaryText
 * @returns {Promise<boolean>} true when a check run was created
 */
async function publishRiskGateOnHead(pass, summaryText) {
  if (!shouldPublishHeadCheck(eventName)) return false
  const body = buildRiskGateCheckRun({
    headSha,
    pass,
    summary: summaryText,
    now: new Date().toISOString(),
    detailsUrl: riskGateDetailsUrl(),
  })
  await api(`/repos/${repository}/check-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return true
}

/**
 * Fail closed: report the reason, write the blocking outputs, and exit.
 *
 * A republish event records the failure on the PR head and then exits 0, so
 * the default-branch job does not go red. If that record cannot be written,
 * the process still exits 1.
 *
 * @param {string} message
 * @returns {Promise<never>}
 */
async function failClosed(message) {
  const text = `## ❌ 合并闸：无法判定\n\n${message}\n\n按失败处理（读不到 ≠ 没问题）。`
  summary(text)
  writeOutputs({ risk: 'A', decision: 'disable', tier: 'blocked' })
  let published = false
  if (shouldPublishHeadCheck(eventName)) {
    try {
      published = await publishRiskGateOnHead(false, text)
    } catch (err) {
      summary(`没能把失败结果写到 PR 当前提交上：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  process.exit(gateJobExitCode({ eventName, pass: false, headCheckPublished: published }))
}

/**
 * Call the GitHub REST API with the same headers as `check-fix-scope.mjs`.
 *
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/**
 * Cap on how many changed files this script will look at (30 pages × 100).
 *
 * A PR with more files than this cap cannot be rated safely: the last page is
 * full but there may be more, and one file we did not read could be A. So this
 * caller treats "hit the cap" as `unreadable` (see `PageCapReached` below),
 * which `classifyRisk` rates A, rather than silently rating from a truncated
 * list. `check-risk-gate.mjs` is the only file listing consumer in this
 * control plane, so keeping the guard here rather than inside the paginator
 * keeps each call explicit about what it does with the cap.
 */
const CHANGED_FILE_CAP = 3000

/**
 * Marker error: the paginator reached the cap and could not confirm the list
 * is complete. Caller catches this specifically and hands `undefined` to
 * `classifyRisk`, which rates A.
 */
class PageCapReached extends Error {}

/**
 * Paginated list of files changed by the PR, up to `CHANGED_FILE_CAP`.
 *
 * @returns {Promise<any[]>}
 * @throws {PageCapReached} when a full last page is followed by no signal the
 *   list has ended — a truncated list must not be handed back as "the diff".
 */
async function listPullRequestFiles() {
  const files = []
  const maxPages = CHANGED_FILE_CAP / 100
  for (let page = 1; page <= maxPages; page++) {
    const batch = await api(`/repos/${repository}/pulls/${pr}/files?per_page=100&page=${page}`)
    files.push(...batch)
    if (batch.length < 100) return files
  }
  throw new PageCapReached(`改动文件超过 ${CHANGED_FILE_CAP} 上限，无法读全，按 A 处理`)
}

/**
 * Paginated list of issue comments, mapped to `{ author, body }`.
 *
 * @returns {Promise<Array<{author: string|null, body: string}>>}
 */
async function listIssueComments() {
  const sources = []
  for (let page = 1; page <= 30; page++) {
    const batch = await api(`/repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`)
    for (const c of batch) {
      sources.push({ author: c?.user?.login ?? null, body: c?.body ?? '' })
    }
    if (batch.length < 100) break
  }
  return sources
}

/** GraphQL page size. A further page we did not read fails closed. */
const CODEX_THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviews(last:100){
        pageInfo{hasNextPage}
        nodes{author{login} state body commit{oid}}
      }
      reviewThreads(first:100){
        pageInfo{hasNextPage}
        nodes{
          isResolved
          comments(first:30){
            pageInfo{hasNextPage}
            nodes{author{login} body commit{oid}}
          }
        }
      }
    }
  }
}`

/**
 * Reviews and threads. `isResolved` exists only on GraphQL. A failed or
 * truncated read is not a clean review.
 *
 * @returns {Promise<{reviews: object[], threads: object[], threadsReadable: boolean}>}
 */
async function listCodexThreadsFromGraphql() {
  const [owner, name] = String(repository).split('/')
  const payload = await api('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: CODEX_THREADS_QUERY,
      variables: { owner, name, number: Number(pr) },
    }),
  })
  const pull = payload?.data?.repository?.pullRequest
  if (payload?.errors || !pull) throw new Error('Codex 审查讨论串读不到')
  let commentsComplete = true
  const threads = (pull.reviewThreads?.nodes ?? []).map((node) => {
    if (node?.comments?.pageInfo?.hasNextPage === true) commentsComplete = false
    const comments = (node?.comments?.nodes ?? []).map((comment) => ({
      author: comment?.author?.login ?? null,
      commitId: comment?.commit?.oid ?? null,
      body: typeof comment?.body === 'string' ? comment.body : '',
    }))
    return { resolved: node?.isResolved === true, comments }
  })
  const reviews = (pull.reviews?.nodes ?? []).map((review) => ({
    author: review?.author?.login ?? null,
    commitId: review?.commit?.oid ?? null,
    state: review?.state ?? null,
    body: typeof review?.body === 'string' ? review.body : '',
  }))
  const complete =
    pull.reviews?.pageInfo?.hasNextPage !== true &&
    pull.reviewThreads?.pageInfo?.hasNextPage !== true &&
    commentsComplete
  return { reviews, threads, threadsReadable: complete }
}

/**
 * Post one issue comment. Throws on failure so the caller fails closed.
 *
 * @param {string} body
 * @returns {Promise<void>}
 */
async function postIssueComment(body) {
  await api(`/repos/${repository}/issues/${pr}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
}

/**
 * Read the PR and verify the run is still bound to its current head/base.
 *
 * @returns {Promise<{declaredRisk: 'A'|'B'|'C'|null, declaredUnreadable: string|null, body: string}>}
 */
async function loadPullRequest() {
  const data = await api(`/repos/${repository}/pulls/${pr}`)
  if (data?.head?.sha !== headSha || data?.base?.sha !== baseSha) {
    throw new Error('这次运行绑定的 head/base 已不是 PR 当前的 head/base，判定作废')
  }
  const body = typeof data?.body === 'string' ? data.body : ''
  const declared = readDeclaredRisk(body)
  return { declaredRisk: declared.risk, declaredUnreadable: declared.unreadable, body }
}

/** Largest file the trial-run check will read. Anything bigger reads as `null`. */
const TRIAL_RUN_READ_CAP = 64 * 1024

/**
 * Read files at the PR head through the contents API — as DATA only, never
 * checked out or executed. A file that cannot be read, is too big, or is not a
 * plain base64 file comes back `null`, which the trial-run check treats as
 * "needs a trial run".
 *
 * @param {string[]} paths
 * @returns {Promise<Record<string, string|null>>}
 */
async function readHeadFiles(paths) {
  const out = {}
  for (const path of paths) {
    try {
      const encoded = path.split('/').map(encodeURIComponent).join('/')
      const data = await api(`/repos/${repository}/contents/${encoded}?ref=${headSha}`)
      const ok = data?.type === 'file' && data?.encoding === 'base64' && Number(data?.size) <= TRIAL_RUN_READ_CAP
      out[path] = ok ? Buffer.from(String(data.content), 'base64').toString('utf8') : null
    } catch {
      out[path] = null
    }
  }
  return out
}

/**
 * Build the human summary text for the step summary and the posted comment.
 *
 * @param {{rating: any, decision: any, signoff: any, ignoredMarkers: number, filesError: string|null, trialRun: any, spotSample: {reason: string}|null, spotChecks: {present: string[]}|null, trustReady: boolean}} input
 * @returns {string}
 */
function buildSummaryText({ rating, decision, signoff, ignoredMarkers, filesError, trialRun, spotSample, spotChecks, trustReady }) {
  const lines = [
    summariseDecision({
      risk: rating.risk,
      reasons: rating.reasons,
      decision,
      ignoredMarkers,
    }),
  ]
  if (rating.risk === 'A') {
    lines.push(`- 签字：已有 ${signoff.present.join('/') || '无'}，缺 ${signoff.missing.join('/') || '无'}`)
    lines.push('- 现阶段：两方签字自动写入尚未建成，A 级由 PM 决定是否以管理员身份合并')
    if (!trustReady) {
      lines.push('- 可信身份还没按角色配好：仓库变量要写成 codex-astra=登录名,claude-code=另一个登录名')
    }
  }
  if (rating.risk === 'B' && spotSample) {
    lines.push(`- 抽查：${spotSample.reason}`)
    if (spotChecks && spotChecks.present.length > 0) {
      lines.push(`- 抽查记录（不挡合并）：${spotChecks.present.join('/')}`)
    }
  }
  lines.push(...describeTrialRun(trialRun))
  if (filesError) {
    lines.push(`- 改动清单读取失败：${filesError}`)
  }
  return lines.join('\n')
}

// --- Main -------------------------------------------------------------------

for (const [name, value] of requiredEnv()) {
  if (typeof value !== 'string' || value === '') {
    await failClosed(`缺少必需的环境变量 ${name}`)
  }
}
if (!SHA_RE.test(baseSha) || !SHA_RE.test(headSha)) {
  await failClosed('BASE_SHA / HEAD_SHA 不是 40 位十六进制 sha')
}

try {
  const { declaredRisk, declaredUnreadable, body } = await loadPullRequest()

  // A failure to read the file list is NOT rethrown: `classifyRisk` rates an
  // unreadable list as A, and the error text is carried into the summary so a
  // reader can tell "we could not look" from "we looked and it was fine".
  let files
  let filesError = null
  try {
    files = await listPullRequestFiles()
  } catch (err) {
    files = undefined
    filesError = err.message
  }

  const rating = classifyRisk({ files, declaredRisk, declaredUnreadable })

  const sources = await listIssueComments()

  // Gate marker: a record of the rating, not an input to it.
  const trustedGate = selectTrustedGateMarkers({ sources, trustedAuthors: [GATE_MARKER_AUTHOR] })
  const ignoredGate = parseGateMarkers(sources.map((s) => s.body)).length - trustedGate.length
  const existing = findGateFor({ markers: trustedGate, base: baseSha, head: headSha })

  // Sign-off: only consulted when the rating is A, but always computed so the
  // summary can report it. Spot checks are reported for B and never block.
  const review = reviewSignoffState({
    rawTrust: signoffTrustedLogins,
    sources,
    prAuthor,
    base: baseSha,
    head: headSha,
  })
  const signoff = review.signoff
  const ignoredSignoff = review.ignoredMarkers
  const spotSample = shouldRequestLegacySpotCheck({ risk: rating.risk, pr, sha: headSha })
  const bound = review.trust.byRole
  const trustReady =
    typeof bound['codex-astra'] === 'string' &&
    typeof bound['claude-code'] === 'string' &&
    bound['codex-astra'] !== bound['claude-code']

  // 当场试跑 can only make the decision stricter — it never yields `enable`.
  const trialRun = await evaluateTrialRunSafely({
    files,
    body,
    today: new Date().toISOString().slice(0, 10),
    readFiles: readHeadFiles,
  })
  let codexReview = { clear: false, reviewed: false, blocking: 0, reason: 'Codex 还没审过当前这次提交' }
  if (rating.risk === 'B' || rating.risk === 'C') {
    try {
      const inputs = await listCodexThreadsFromGraphql()
      codexReview = evaluateCodexHeadReview({
        head: headSha,
        trustedLogin: bound['codex-astra'],
        prAuthor,
        comments: sources,
        reviews: inputs.reviews,
        threads: inputs.threads,
        threadsReadable: inputs.threadsReadable,
      })
    } catch (err) {
      codexReview = {
        clear: false,
        reviewed: false,
        blocking: 0,
        reason: `Codex 审查读不到（${err instanceof Error ? err.message : String(err)}）`,
      }
    }
  }
  const decision = applyTrialRunToDecision({
    decision: decideMerge({
      risk: rating.risk,
      draft: parseTriState(prDraft),
      fork: parseTriState(prIsFork),
      signoff,
      codexReview,
    }),
    trialRun,
  })

  let summaryText = buildSummaryText({
    rating,
    decision,
    signoff,
    ignoredMarkers: ignoredGate + ignoredSignoff,
    filesError,
    trialRun,
    spotSample,
    spotChecks: review.spotChecks,
    trustReady,
  })
  if (shouldPublishHeadCheck(eventName)) {
    summaryText += '\n- 检查结果写在 PR 当前这次提交上，不记在主干提交上'
  }
  summary(summaryText)

  // Invariant: `enable` only when pass && tier === 'auto'. Every other path
  // writes `disable`, so a stale `enable` cannot survive a later evaluation.
  const outputDecision =
    decision.pass === true && decision.tier === 'auto' ? decision.decision : 'disable'

  // Record the head check before the rating comment. A failed publish must not
  // leave a comment that says the gate passed, and must not arm auto-merge.
  let published = false
  try {
    published = await publishRiskGateOnHead(decision.pass === true, summaryText)
  } catch (err) {
    summary(`没能把合并闸结果写到 PR 当前提交上：${err instanceof Error ? err.message : String(err)}`)
    writeOutputs({ risk: rating.risk, decision: 'disable', tier: 'blocked' })
    process.exit(1)
  }

  // Post the rating only when there is no current marker for this exact pair,
  // or the one on record disagrees with what we just computed. The decision is
  // compared too: an `edited` run that fills in 当场试跑 changes the decision
  // without changing the head, and a stale "❌" comment would mislead the PM
  // (魏征 W78-2, #2078).
  if (shouldPostGateComment({ existing, risk: rating.risk, decision: outputDecision })) {
    const marker = buildGateMarker({
      base: baseSha,
      head: headSha,
      risk: rating.risk,
      reasons: rating.reasons,
      decision: outputDecision,
    })
    await postIssueComment(`${summaryText}\n\n${marker}`)
  }

  writeOutputs({ risk: rating.risk, decision: outputDecision, tier: decision.tier })
  process.exit(
    gateJobExitCode({ eventName, pass: decision.pass === true, headCheckPublished: published }),
  )
} catch (err) {
  await failClosed(err instanceof Error ? err.message : String(err))
}
