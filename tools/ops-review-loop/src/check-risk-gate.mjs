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
 * end in `decision=disable tier=blocked risk=A` and exit 1.
 *
 * 🔴 **Gate markers are read only from `GATE_MARKER_AUTHOR`.** A marker is a
 * verdict, and anyone who can comment on a PR can type one. The identity that
 * writes the rating is this workflow's own bot login — never the PR author's
 * login, which would let a PR author rate their own change.
 */

import { appendFileSync } from 'node:fs'

import { classifyRisk, parseDeclaredRisk } from './risk.mjs'
import { buildGateMarker, findGateFor, parseGateMarkers, selectTrustedGateMarkers } from './gate-marker.mjs'
import { evaluateSignoffs, parseSignoffMarkers, selectTrustedSignoffMarkers } from './signoff-marker.mjs'
import { decideMerge, summariseDecision } from './merge-decision.mjs'

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
 * Fail closed: report the reason, write the blocking outputs, and exit 1.
 *
 * @param {string} message
 * @returns {never}
 */
function failClosed(message) {
  summary(`## ❌ 合并闸：无法判定\n\n${message}\n\n按失败处理（读不到 ≠ 没问题）。`)
  writeOutputs({ risk: 'A', decision: 'disable', tier: 'blocked' })
  process.exit(1)
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
 * Paginated list of files changed by the PR (30 pages × 100).
 *
 * @returns {Promise<any[]>}
 */
async function listPullRequestFiles() {
  const files = []
  for (let page = 1; page <= 30; page++) {
    const batch = await api(`/repos/${repository}/pulls/${pr}/files?per_page=100&page=${page}`)
    files.push(...batch)
    if (batch.length < 100) break
  }
  return files
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
 * @returns {Promise<{declaredRisk: 'A'|'B'|'C'|null}>}
 */
async function loadPullRequest() {
  const data = await api(`/repos/${repository}/pulls/${pr}`)
  if (data?.head?.sha !== headSha || data?.base?.sha !== baseSha) {
    throw new Error('这次运行绑定的 head/base 已不是 PR 当前的 head/base，判定作废')
  }
  return { declaredRisk: parseDeclaredRisk(data?.body) }
}

/**
 * Build the human summary text for the step summary and the posted comment.
 *
 * @param {{rating: any, decision: any, signoff: any, ignoredMarkers: number, filesError: string|null}} input
 * @returns {string}
 */
function buildSummaryText({ rating, decision, signoff, ignoredMarkers, filesError }) {
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
    lines.push('- 现阶段：签字自动写入尚未建成，A 级由 PM 决定是否以管理员身份合并')
  }
  if (filesError) {
    lines.push(`- 改动清单读取失败：${filesError}`)
  }
  return lines.join('\n')
}

// --- Main -------------------------------------------------------------------

for (const [name, value] of requiredEnv()) {
  if (typeof value !== 'string' || value === '') {
    failClosed(`缺少必需的环境变量 ${name}`)
  }
}
if (!SHA_RE.test(baseSha) || !SHA_RE.test(headSha)) {
  failClosed('BASE_SHA / HEAD_SHA 不是 40 位十六进制 sha')
}

try {
  const { declaredRisk } = await loadPullRequest()

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

  const rating = classifyRisk({ files, declaredRisk })

  const sources = await listIssueComments()

  // Gate marker: a record of the rating, not an input to it.
  const trustedGate = selectTrustedGateMarkers({ sources, trustedAuthors: [GATE_MARKER_AUTHOR] })
  const ignoredGate = parseGateMarkers(sources.map((s) => s.body)).length - trustedGate.length
  const existing = findGateFor({ markers: trustedGate, base: baseSha, head: headSha })

  // Sign-off: only consulted when the rating is A, but always computed so the
  // summary can report it.
  const trustedLogins = signoffTrustedLogins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const signoffMarkers = selectTrustedSignoffMarkers({
    sources,
    trustedAuthors: trustedLogins,
    prAuthor,
  })
  const ignoredSignoff = parseSignoffMarkers(sources.map((s) => s.body)).length - signoffMarkers.length
  const signoff = evaluateSignoffs({ markers: signoffMarkers, base: baseSha, head: headSha })

  const decision = decideMerge({
    risk: rating.risk,
    draft: parseTriState(prDraft),
    fork: parseTriState(prIsFork),
    signoff,
  })

  const summaryText = buildSummaryText({
    rating,
    decision,
    signoff,
    ignoredMarkers: ignoredGate + ignoredSignoff,
    filesError,
  })
  summary(summaryText)

  // Post the rating only when there is no current marker for this exact pair,
  // or the one on record disagrees with what we just computed.
  if (!existing || existing.risk !== rating.risk) {
    const marker = buildGateMarker({
      base: baseSha,
      head: headSha,
      risk: rating.risk,
      reasons: rating.reasons,
    })
    await postIssueComment(`${summaryText}\n\n${marker}`)
  }

  // Invariant: `enable` only when pass && tier === 'auto'. Every other path
  // writes `disable`, so a stale `enable` cannot survive a later evaluation.
  const outputDecision =
    decision.pass === true && decision.tier === 'auto' ? decision.decision : 'disable'
  writeOutputs({ risk: rating.risk, decision: outputDecision, tier: decision.tier })

  process.exit(decision.pass ? 0 : 1)
} catch (err) {
  failClosed(err instanceof Error ? err.message : String(err))
}
