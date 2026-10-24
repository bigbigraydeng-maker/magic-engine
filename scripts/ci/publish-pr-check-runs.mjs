/**
 * Turn one pull-request test job's step outcomes into the legacy required
 * check names (Ledger entries valid, Kernel architecture test, …).
 *
 * The test job must not hold `checks: write`: the code under test could post
 * a green check for itself. The report job checks this file out from `main`
 * and is the only job allowed to publish. A pull request that does not edit
 * the workflow cannot change the conclusions.
 *
 * Exit 1 when any published check failed, so the report job stays red.
 */

import { appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/**
 * @typedef {{ name: string, outcomeEnv: string, needsInstall?: boolean, allowSkip?: boolean, publishWhenSkipped?: boolean }} CheckSpec
 */

/** Names are the Protect main / visible check strings. Do not rename them here. */
export const CHECKS = [
  { name: 'Ledger entries valid', outcomeEnv: 'OUTCOME_LEDGER_ENTRIES', needsInstall: true },
  { name: 'Code change has ledger entry', outcomeEnv: 'OUTCOME_LEDGER_CODE', allowSkip: true },
  { name: 'Ledger refs exist', outcomeEnv: 'OUTCOME_LEDGER_REFS', allowSkip: true },
  { name: 'ai-orchestrator-tests', outcomeEnv: 'OUTCOME_ORCHESTRATOR', needsInstall: true },
  { name: 'ops-review-loop-tests', outcomeEnv: 'OUTCOME_OPS_REVIEW', needsInstall: true },
  { name: 'Kernel architecture test', outcomeEnv: 'OUTCOME_KERNEL', needsInstall: true },
  { name: 'Tour catalog boundary test', outcomeEnv: 'OUTCOME_TOUR', needsInstall: true },
  { name: 'factory-worker-tests', outcomeEnv: 'OUTCOME_FACTORY', needsInstall: true },
  { name: 'fix-scope', outcomeEnv: 'OUTCOME_FIX_SCOPE' },
  { name: 'CRM focused tests', outcomeEnv: 'OUTCOME_CRM', needsInstall: true },
  {
    name: 'Ledger verify branch shape',
    outcomeEnv: 'OUTCOME_LEDGER_VERIFY',
    allowSkip: true,
    publishWhenSkipped: false,
  },
]

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ checks: { name: string, conclusion: 'success' | 'failure', summary: string }[], failed: boolean }}
 */
export function planChecks(env) {
  const installOk = env.OUTCOME_INSTALL === 'success'
  const treeDirty = treeIsDirty(env)
  const harness = harnessBroken(env, installOk)
  const checks = []
  let failed = treeDirty || harness

  for (const spec of CHECKS) {
    const outcome = env[spec.outcomeEnv] ?? ''
    const decided = decide(spec, outcome, { installOk, treeDirty, harness })
    if (decided.publish) checks.push({ name: spec.name, conclusion: decided.conclusion, summary: decided.summary })
    if (decided.conclusion === 'failure') failed = true
  }

  return { checks, failed }
}

/** A missing clean-step result is not dirty. A failed clean step is, even if it wrote no flag. */
function treeIsDirty(env) {
  if (env.TREE_DIRTY === '1') return true
  const clean = env.OUTCOME_CLEAN
  if (clean == null || clean === '' || clean === 'success' || clean === 'skipped') return false
  return true
}

/**
 * Publisher unit tests are the harness. When they are present and not green,
 * the step outcomes cannot be trusted, so every published check fails closed.
 * Unset means this caller is not the workflow (unit tests); do not invent a failure.
 * @param {Record<string, string | undefined>} env
 * @param {boolean} installOk
 */
function harnessBroken(env, installOk) {
  const outcome = env.OUTCOME_PUBLISHER
  if (outcome == null || outcome === '' || outcome === 'success') return false
  if (outcome === 'skipped' && !installOk) return false
  return true
}

/**
 * @param {CheckSpec} spec
 * @param {string} outcome
 * @param {{ installOk: boolean, treeDirty: boolean, harness: boolean }} ctx
 */
function decide(spec, outcome, ctx) {
  if (ctx.treeDirty) {
    return { publish: true, conclusion: 'failure', summary: `${spec.name}：检查过程改动了仓库文件，结果作废。` }
  }
  if (ctx.harness) {
    return { publish: true, conclusion: 'failure', summary: `${spec.name}：检查脚本自己的测试没通过，结果作废。` }
  }
  if (spec.needsInstall && !ctx.installOk) {
    return { publish: true, conclusion: 'failure', summary: `${spec.name}：依赖没装上，这项没有跑。` }
  }
  if (outcome === 'success') {
    return { publish: true, conclusion: 'success', summary: `${spec.name}：通过。日志在「Run PR checks」那个任务里。` }
  }
  if (outcome === 'skipped' && spec.allowSkip) {
    const publish = spec.publishWhenSkipped !== false
    return {
      publish,
      conclusion: 'success',
      summary: `${spec.name}：这条分支不用跑这项。`,
    }
  }
  const why = outcome === '' ? '没有结果' : outcome
  return { publish: true, conclusion: 'failure', summary: `${spec.name}：没通过（${why}）。打开「Run PR checks」里同名的那一步。` }
}

/**
 * @param {{ name: string, conclusion: string, summary: string }[]} checks
 * @param {Record<string, string | undefined>} env
 */
export function publishChecks(checks, env) {
  const repo = env.GITHUB_REPOSITORY ?? ''
  const sha = env.HEAD_SHA ?? ''
  if (!/^[0-9a-f]{40}$/i.test(sha) || !repo.includes('/')) {
    throw new Error('refuse to publish without a repository and a full head SHA')
  }
  const now = new Date().toISOString()
  for (const item of checks) {
    const body = JSON.stringify({
      name: item.name,
      head_sha: sha,
      status: 'completed',
      conclusion: item.conclusion,
      started_at: now,
      completed_at: now,
      output: { title: item.name, summary: item.summary },
    })
    execFileSync('gh', ['api', '--method', 'POST', `repos/${repo}/check-runs`, '--input', '-'], {
      input: body,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, GH_TOKEN: env.GH_TOKEN || env.GITHUB_TOKEN || '' },
    })
  }
}

function writeSummary(checks, failed) {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (!path) return
  const lines = ['## 检查结果', '']
  for (const item of checks) lines.push(`- ${item.conclusion === 'success' ? '通过' : '没通过'} · ${item.name}`)
  if (checks.length === 0) lines.push('- （没有需要上报的检查）')
  lines.push('', failed ? '有检查没通过。' : '全部通过。')
  appendFileSync(path, `${lines.join('\n')}\n`)
}

function main() {
  const planned = planChecks(process.env)
  for (const item of planned.checks) console.log(`${item.conclusion}\t${item.name}`)
  writeSummary(planned.checks, planned.failed)
  if (process.env.PUBLISH_CHECKS === '1') publishChecks(planned.checks, process.env)
  if (planned.failed) process.exit(1)
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('publish-pr-check-runs.mjs')
if (isDirectRun) main()
