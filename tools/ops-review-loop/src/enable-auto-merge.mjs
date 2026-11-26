import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { planAutoMergeEnable } from './head-check.mjs'

/**
 * Turn auto-merge on after the risk gate has already decided `enable`.
 *
 * This file does not re-check sign-off, required checks, review threads,
 * drafts, forks, or the Ray-merge hold. The workflow step runs only when
 * `steps.gate.outputs.decision == 'enable'`. A condition that failed earlier
 * never reaches here.
 *
 * GitHub refuses `enablePullRequestAutoMerge` for a pull request that belongs
 * to a native stack. That refusal is not a failed gate: the check stays green,
 * auto-merge stays off, and a person with permission merges from the bottom of
 * the stack. Every other failure to arm auto-merge still fails the step.
 *
 * Stack membership is read first (`PullRequest.stack`). A query that fails or
 * comes back unreadable is not treated as stacked — the merge command still
 * runs, and only the known stacked-PR error from that command is a pass.
 */

/** Sentence written on the check when a cleared stacked PR cannot auto-merge. */
export const STACKED_AUTO_MERGE_NOTE =
  '叠放 PR 不支持自动合并；闸已判可合，需由有权限的人或 agent 手动合并（先合栈底）'

const STALE_HEAD_SUMMARY = '- 自动合并：未开启（这次审的提交已经不是 PR 当前提交）'
const UNCONFIRMED_SUMMARY = '- 自动合并：未开启（无法确认当前提交）'
const ENABLED_SUMMARY = '- 自动合并：已开启（必过检查全绿后由 GitHub 合并）'
const ENABLE_FAILED_SUMMARY = '- 自动合并：开启失败'

const STACK_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){stack{number}}}}'

const REPO_PART = /^[A-Za-z0-9_.-]+$/
const PR_NUMBER = /^[1-9]\d*$/
const HEAD_SHA = /^[0-9a-f]{40}$/i

const STACKED_MUTATION = /enablePullRequestAutoMerge/i
const STACKED_REASON =
  /auto-merge is not supported for stacked pull requests|part of a stack|stacked pull requests?/i

/**
 * `plain` only when GitHub says `stack` is null. Anything unreadable is
 * `unknown`, so a schema or network miss still attempts auto-merge.
 *
 * @param {unknown} body
 * @returns {'stacked'|'plain'|'unknown'}
 */
export function classifyStackPayload(body) {
  let parsed
  try {
    parsed = JSON.parse(String(body ?? ''))
  } catch {
    return 'unknown'
  }
  if (!parsed || typeof parsed !== 'object') return 'unknown'
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) return 'unknown'
  const pullRequest = parsed.data?.repository?.pullRequest
  if (!pullRequest || typeof pullRequest !== 'object') return 'unknown'
  if (!Object.prototype.hasOwnProperty.call(pullRequest, 'stack')) return 'unknown'
  if (pullRequest.stack === null) return 'plain'
  if (typeof pullRequest.stack === 'object') return 'stacked'
  return 'unknown'
}

/**
 * True only for GitHub's refusal to arm auto-merge on a stacked pull request.
 * Other `enablePullRequestAutoMerge` errors stay failures.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function isStackedAutoMergeRefusal(text) {
  if (typeof text !== 'string' || text.trim() === '') return false
  return STACKED_MUTATION.test(text) && STACKED_REASON.test(text)
}

/**
 * GraphQL argv for a stack-membership read, or null when the coordinates are
 * not a single owner/name and a pull request number.
 *
 * @param {unknown} repository
 * @param {unknown} prNumber
 * @returns {string[]|null}
 */
export function stackQueryArgs(repository, prNumber) {
  if (typeof repository !== 'string' || typeof prNumber !== 'string') return null
  if (!PR_NUMBER.test(prNumber)) return null
  const slash = repository.indexOf('/')
  if (slash <= 0 || slash !== repository.lastIndexOf('/')) return null
  const owner = repository.slice(0, slash)
  const name = repository.slice(slash + 1)
  if (!REPO_PART.test(owner) || !REPO_PART.test(name)) return null
  return [
    'api',
    'graphql',
    '-f',
    `query=${STACK_QUERY}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${prNumber}`,
  ]
}

/**
 * Arguments for `gh pr merge --auto`, or null when the plan is not a pinned
 * enable. `--admin` is never forwarded.
 *
 * @param {{enable?: boolean, args?: string[]}|null|undefined} plan
 * @param {unknown} prNumber
 * @returns {string[]|null}
 */
export function mergeCommand(plan, prNumber) {
  if (!plan || plan.enable !== true || !Array.isArray(plan.args)) return null
  if (typeof prNumber !== 'string' || !PR_NUMBER.test(prNumber)) return null
  const args = plan.args.map(String)
  if (args.includes('--admin') || args.includes('--squash') || args.includes('--rebase')) return null
  const headAt = args.indexOf('--match-head-commit')
  if (args[0] !== 'pr' || args[1] !== 'merge' || !args.includes('--auto') || !args.includes('--merge')) return null
  if (headAt < 0 || !HEAD_SHA.test(args[headAt + 1] ?? '')) return null
  return [...args, prNumber]
}

/**
 * @param {string[]} args
 * @returns {{code: number, stdout: string, stderr: string}}
 */
export function defaultGhExec(args) {
  try {
    const stdout = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    const error = /** @type {{ status?: unknown, stdout?: unknown, stderr?: unknown }} */ (err)
    const code = typeof error.status === 'number' ? error.status : 1
    const stdout = typeof error.stdout === 'string' ? error.stdout : ''
    const stderr = typeof error.stderr === 'string' ? error.stderr : ''
    return { code, stdout, stderr }
  }
}

/**
 * @param {(args: string[]) => {code?: number, stdout?: string, stderr?: string}} exec
 * @param {NodeJS.ProcessEnv} env
 * @returns {{head?: string, error?: string}}
 */
function readLiveHead(exec, env) {
  const pr = env.PR_NUMBER
  const repo = env.GITHUB_REPOSITORY
  if (!pr || !repo) return { error: 'missing pull request coordinates' }
  let view
  try {
    view = exec(['pr', 'view', pr, '--repo', repo, '--json', 'headRefOid', '--jq', '.headRefOid'])
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  if (!view || view.code !== 0) {
    const detail = `${view?.stdout ?? ''}\n${view?.stderr ?? ''}`.trim()
    return { error: detail || 'gh pr view failed' }
  }
  return { head: String(view.stdout ?? '').trim() }
}

/**
 * @param {(args: string[]) => {code?: number, stdout?: string, stderr?: string}} exec
 * @param {string|undefined} repository
 * @param {string|undefined} prNumber
 * @returns {'stacked'|'plain'|'unknown'}
 */
function readStackState(exec, repository, prNumber) {
  const args = stackQueryArgs(repository, prNumber)
  if (args === null) return 'unknown'
  try {
    const result = exec(args)
    if (!result || result.code !== 0) return 'unknown'
    return classifyStackPayload(result.stdout ?? '')
  } catch {
    return 'unknown'
  }
}

/**
 * @param {(text: string) => void} writeSummary
 * @param {(text: string) => void} writeNotice
 * @returns {0}
 */
function finishStacked(writeSummary, writeNotice) {
  writeNotice(STACKED_AUTO_MERGE_NOTE)
  writeSummary(`- ${STACKED_AUTO_MERGE_NOTE}`)
  return 0
}

/**
 * @param {{env: NodeJS.ProcessEnv, exec: (args: string[]) => {code?: number, stdout?: string, stderr?: string}, writeSummary: (text: string) => void, writeNotice: (text: string) => void, writeError: (text: string) => void, writeLog: (text: string) => void}} input
 * @returns {0|1}
 */
export function runEnableAutoMerge({ env, exec, writeSummary, writeNotice, writeError, writeLog }) {
  const view = readLiveHead(exec, env)
  if (view.error) {
    writeLog(view.error)
    writeSummary(UNCONFIRMED_SUMMARY)
    return 1
  }
  const plan = planAutoMergeEnable({ boundHead: env.HEAD_SHA, liveHead: view.head })
  if (plan.enable !== true) {
    writeSummary(STALE_HEAD_SUMMARY)
    return 0
  }
  const command = mergeCommand(plan, env.PR_NUMBER)
  if (command === null) {
    writeSummary(UNCONFIRMED_SUMMARY)
    return 1
  }
  if (readStackState(exec, env.GITHUB_REPOSITORY, env.PR_NUMBER) === 'stacked') {
    return finishStacked(writeSummary, writeNotice)
  }
  const merge = exec(command)
  const output = `${merge?.stdout ?? ''}\n${merge?.stderr ?? ''}`
  if (!merge || merge.code !== 0) writeLog(output)
  if (merge && merge.code === 0) {
    writeSummary(ENABLED_SUMMARY)
    return 0
  }
  if (isStackedAutoMergeRefusal(output)) return finishStacked(writeSummary, writeNotice)
  writeError('自动合并：开启失败')
  writeSummary(ENABLE_FAILED_SUMMARY)
  return 1
}

/**
 * @param {string} text
 */
function writeStepSummary(text) {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (path) appendFileSync(path, `${text}\n`)
  console.log(text)
}

const entry = process.argv[1]
const invokedDirectly = typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href
if (invokedDirectly) {
  const code = runEnableAutoMerge({
    env: process.env,
    exec: defaultGhExec,
    writeSummary: writeStepSummary,
    writeNotice: (text) => console.log(`::notice title=Risk gate::${text}`),
    writeError: (text) => console.log(`::error title=Risk gate::${text}`),
    writeLog: (text) => process.stderr.write(text.endsWith('\n') ? text : `${text}\n`),
  })
  process.exit(code)
}
