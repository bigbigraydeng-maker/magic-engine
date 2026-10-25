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
import { readRayHoldFiles } from './ray-file-read.mjs'
import { assessRayMergeHold, classifyRisk, readDeclaredRisk } from './risk.mjs'
import { requiredChecksAreGreen } from './required-checks.mjs'
import {
  buildGateMarker,
  findGateFor,
  parseGateMarkers,
  selectTrustedGateMarkers,
  shouldPostGateComment,
} from './gate-marker.mjs'
import {
  evaluateClaudeHeadSignoff,
  evaluateCodexHeadReview,
  reviewConversationsResolved,
  reviewSignoffState,
} from './signoff-marker.mjs'
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
 * @param {unknown} node
 * @returns {{name: string, status: string, conclusion: string, completedAt?: string}|null}
 */
function mapRollupNode(node) {
  if (!node || typeof node !== 'object') return null
  const row = /** @type {{__typename?: unknown, name?: unknown, conclusion?: unknown, status?: unknown, completedAt?: unknown, context?: unknown, state?: unknown}} */ (
    node
  )
  if (row.__typename === 'CheckRun' && typeof row.name === 'string') {
    const mapped = {
      name: row.name,
      status: String(row.status || '').toLowerCase(),
      conclusion: String(row.conclusion || '').toLowerCase(),
    }
    if (typeof row.completedAt === 'string' && row.completedAt !== '') mapped.completedAt = row.completedAt
    return mapped
  }
  if (row.__typename === 'StatusContext' && typeof row.context === 'string') {
    const state = String(row.state || '').toUpperCase()
    if (state === 'SUCCESS') return { name: row.context, status: 'completed', conclusion: 'success' }
    if (state === 'PENDING' || state === 'EXPECTED') return { name: row.context, status: 'queued', conclusion: '' }
    return { name: row.context, status: 'completed', conclusion: 'failure' }
  }
  return null
}

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

const CHECK_ROLLUP_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      statusCheckRollup{
        contexts(first:100){
          pageInfo{hasNextPage}
          nodes{
            __typename
            ... on CheckRun{name conclusion status completedAt}
            ... on StatusContext{context state}
          }
        }
      }
    }
  }
}`

/**
 * Required checks on the PR head. A failed or truncated read is not green.
 * Kept separate from the review query so a checks-permission miss cannot
 * hide a Codex review.
 *
 * @returns {Promise<{checks: object[], checksReadable: boolean}>}
 */
async function listCheckRollup() {
  const [owner, name] = String(repository).split('/')
  const payload = await api('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: CHECK_ROLLUP_QUERY,
      variables: { owner, name, number: Number(pr) },
    }),
  })
  const rollup = payload?.data?.repository?.pullRequest?.statusCheckRollup
  const contexts = rollup?.contexts
  if (payload?.errors || !contexts) return { checks: [], checksReadable: false }
  const nodes = Array.isArray(contexts.nodes) ? contexts.nodes : []
  return {
    checks: nodes.map(mapRollupNode).filter((node) => node !== null),
    checksReadable: contexts.pageInfo?.hasNextPage !== true,
  }
}

/**
 * Required check names from the active rules on main. Throws when the list
 * cannot be read; the caller then treats the checks as not green.
 *
 * @returns {Promise<string[]>}
 */
async function listRequiredCheckNames() {
  const rules = await api(`/repos/${repository}/rules/branches/main`)
  if (!Array.isArray(rules)) throw new Error('主干必过检查名单读不到')
  /** @type {string[]} */
  const names = []
  for (const rule of rules) {
    const checks = rule?.parameters?.required_status_checks
    if (!Array.isArray(checks)) continue
    for (const check of checks) {
      if (typeof check?.context === 'string' && check.context !== '') names.push(check.context)
    }
  }
  return names
}

/**
 * Required checks, failing closed without taking the review result with them.
 *
 * @returns {Promise<boolean>}
 */
async function readRequiredChecks() {
  try {
    const [requiredNames, rollup] = await Promise.all([listRequiredCheckNames(), listCheckRollup()])
    return requiredChecksAreGreen({
      requiredNames,
      checks: rollup.checks,
      checksReadable: rollup.checksReadable,
    })
  } catch {
    return false
  }
}

/**
 * Codex review, Claude sign-off, required checks, and open threads.
 *
 * A review-query failure closes both sign-offs. A checks-list failure only
 * leaves the required checks red, so a B/C review can still arm auto-merge.
 *
 * @param {{sources: unknown, markers: unknown, codexLogin: unknown, claudeLogin: unknown}} input
 */
async function readHeadVerdict({ sources, markers, codexLogin, claudeLogin }) {
  let inputs
  try {
    inputs = await listCodexThreadsFromGraphql()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const unread = (who) => ({ clear: false, reviewed: false, blocking: 0, reason: `${who}审查读不到（${detail}）` })
    return {
      codexReview: unread('Codex '),
      claudeSignoff: unread('Claude Code '),
      requiredChecksGreen: false,
      conversationsResolved: false,
    }
  }
  const conversations = reviewConversationsResolved({
    threads: inputs.threads,
    threadsReadable: inputs.threadsReadable,
  })
  return {
    codexReview: evaluateCodexHeadReview({
      head: headSha,
      trustedLogin: codexLogin,
      prAuthor,
      comments: sources,
      reviews: inputs.reviews,
      threads: inputs.threads,
      threadsReadable: inputs.threadsReadable,
    }),
    claudeSignoff: evaluateClaudeHeadSignoff({
      head: headSha,
      trustedLogin: claudeLogin,
      prAuthor,
      comments: sources,
      reviews: inputs.reviews,
      markers,
      threads: inputs.threads,
      threadsReadable: inputs.threadsReadable,
    }),
    requiredChecksGreen: await readRequiredChecks(),
    conversationsResolved: conversations.resolved === true,
  }
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

/** Largest file the trial-run check will read. The Ray hold uses `ray-file-read.mjs` instead. */
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
 * @param {{rating: any, decision: any, signoff: any, ignoredMarkers: number, filesError: string|null, trialRun: any, spotSample: {reason: string}|null, spotChecks: {present: string[]}|null, trustReady: boolean, codexReview: {reason?: string}, claudeSignoff: {reason?: string}, requiredChecksGreen: boolean, conversationsResolved: boolean, rayHold: {hold: boolean, reason: string}}} input
 * @returns {string}
 */
function buildSummaryText({
  rating,
  decision,
  signoff,
  ignoredMarkers,
  filesError,
  trialRun,
  spotSample,
  spotChecks,
  trustReady,
  codexReview,
  claudeSignoff,
  requiredChecksGreen,
  conversationsResolved,
  rayHold,
}) {
  const lines = [
    summariseDecision({
      risk: rating.risk,
      reasons: rating.reasons,
      decision,
      ignoredMarkers,
    }),
  ]
  if (rating.risk === 'A') {
    lines.push(`- Codex：${codexReview?.reason ?? '读不到'}`)
    lines.push(`- Claude Code：${claudeSignoff?.reason ?? '读不到'}`)
    lines.push(requiredChecksGreen ? '- 必过检查：已全绿（不含本闸自己）' : '- 必过检查：还没全绿')
    lines.push(conversationsResolved ? '- 审查对话：都已解决' : '- 审查对话：还有没解决的')
    lines.push(`- 旧签字标记：已有 ${signoff.present.join('/') || '无'}，缺 ${signoff.missing.join('/') || '无'}`)
    if (!trustReady) {
      lines.push('- 可信身份还没按角色配好：仓库变量要写成 codex-astra=登录名,claude-code=另一个登录名')
    }
  }
  if (rayHold?.hold) {
    lines.push(`- 留给 Ray 亲手合：${rayHold.reason}`)
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
  // String: whole file, including one read through the git blob API.
  // null: still over 100MB or not at this ref — judge that entry's patch.
  // A read failure (rate limit, 5xx, network) stays for Ray and does not use the diff.
  const rayContents = Array.isArray(files)
    ? await readRayHoldFiles({
        files,
        repository: repository ?? '',
        ref: headSha,
        token: token ?? '',
        fetchImpl: fetch,
      })
    : {}
  const rayHold = assessRayMergeHold(files, rayContents)
  const verdict = await readHeadVerdict({
    sources,
    markers: review.markers,
    codexLogin: bound['codex-astra'],
    claudeLogin: bound['claude-code'],
  })
  const decision = applyTrialRunToDecision({
    decision: decideMerge({
      risk: rating.risk,
      draft: parseTriState(prDraft),
      fork: parseTriState(prIsFork),
      signoff,
      codexReview: verdict.codexReview,
      claudeSignoff: verdict.claudeSignoff,
      requiredChecksGreen: verdict.requiredChecksGreen,
      conversationsResolved: verdict.conversationsResolved,
      rayHold: rayHold.hold,
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
    codexReview: verdict.codexReview,
    claudeSignoff: verdict.claudeSignoff,
    requiredChecksGreen: verdict.requiredChecksGreen,
    conversationsResolved: verdict.conversationsResolved,
    rayHold,
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
    writeOutputs({ risk: rating.risk, decision: 'disable', tier: 'blocked', ray_hold: rayHold.hold ? 'true' : 'false' })
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

  writeOutputs({
    risk: rating.risk,
    decision: outputDecision,
    tier: decision.tier,
    ray_hold: rayHold.hold ? 'true' : 'false',
  })
  process.exit(
    gateJobExitCode({ eventName, pass: decision.pass === true, headCheckPublished: published }),
  )
} catch (err) {
  await failClosed(err instanceof Error ? err.message : String(err))
}
