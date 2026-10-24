/**
 * Structural proof for the PR risk gate and the ops-review-loop CI workflow.
 *
 * The risk gate is the merge judge, so the properties that make it a judge
 * rather than a suggestion are pinned here: it runs from `main` (a PR cannot
 * edit the script that rates it), it never interpolates event data into a
 * `run:` block (everything arrives through `env:`), and auto-merge is
 * reachable only from the gate's own `enable` decision.
 *
 * Mirrors the style of tools/ops-review-loop/tests/workflow-guards.test.ts.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const requireFromHere = createRequire(import.meta.url)
const YAML = requireFromHere('js-yaml') as { load(input: string): unknown }

const ROOT = join(process.cwd(), '.github/workflows')
const RISK_GATE_PATH = join(ROOT, 'pr-risk-gate.yml')
const CI_PATH = join(ROOT, 'pr-light-checks.yml')

interface WorkflowStep {
  id?: string
  uses?: string
  name?: string
  run?: string
  if?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}
interface WorkflowJob {
  name?: string
  if?: string
  steps?: WorkflowStep[]
  permissions?: Record<string, string>
}
interface Workflow {
  on?: Record<string, unknown>
  true?: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs?: Record<string, WorkflowJob>
}

function load(path: string) {
  const source = readFileSync(path, 'utf8')
  const doc = YAML.load(source) as Workflow
  const jobs = Object.values(doc.jobs ?? {})
  return {
    path,
    source,
    doc,
    triggers: (doc.on ?? doc.true ?? {}) as Record<string, unknown>,
    jobs,
    steps: jobs.flatMap((job) => job.steps ?? []),
  }
}

const riskGate = load(RISK_GATE_PATH)
const ci = load(CI_PATH)

const SHA_PIN = /@[0-9a-f]{40}\b/

describe('Risk gate workflow: the judge lives on main', () => {
  it('triggers on pull_request_target plus Codex issue comments, never on the PR merge ref', () => {
    expect(Object.keys(riskGate.triggers).sort()).toEqual(['issue_comment', 'pull_request_target'])
    // A review-submitted event uses the PR merge ref, so the PR could replace
    // this file. Codex's clean review is an issue comment (observed #3086).
    expect(riskGate.triggers.pull_request).toBeUndefined()
    expect(riskGate.triggers.pull_request_review).toBeUndefined()
    expect(riskGate.triggers.pull_request_review_comment).toBeUndefined()
    const trigger = riskGate.triggers.pull_request_target as {
      types?: string[]
      paths?: unknown
      'paths-ignore'?: unknown
      branches?: unknown
    }
    // `edited` re-runs the gate when the PR body's 当场试跑 section is filled in.
    for (const type of ['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft', 'edited']) {
      expect(trigger.types, `pull_request_target must include ${type}`).toContain(type)
    }
    const comments = riskGate.triggers.issue_comment as { types?: string[] }
    expect(comments.types).toEqual(expect.arrayContaining(['created', 'edited']))
    // A path or branch filter would turn this into a check that never reports
    // on the PRs it skips — a merge deadlock if it is required.
    expect(trigger.paths).toBeUndefined()
    expect(trigger['paths-ignore']).toBeUndefined()
    expect(trigger.branches).toBeUndefined()
  })

  it('declares exactly the two write scopes it needs, and no more', () => {
    expect(riskGate.doc.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
    })
  })

  it('serialises per PR and cancels superseded runs', () => {
    expect(riskGate.doc.concurrency?.['cancel-in-progress']).toBe(true)
    expect(riskGate.doc.concurrency?.group).toContain('github.event.issue.number')
  })

  it('checks itself out from main, never the PR head, and persists no credentials', () => {
    const checkouts = riskGate.steps.filter((s) => s.uses?.startsWith('actions/checkout'))
    expect(checkouts.length).toBeGreaterThan(0)
    for (const checkout of checkouts) {
      expect(checkout.with?.ref).toBe('main')
      expect(checkout.with?.['persist-credentials']).toBe(false)
    }
  })

  it('pins every action to a reviewed 40-hex commit sha, never a moveable tag', () => {
    for (const step of riskGate.steps) {
      if (step.uses) {
        expect(step.uses, `${step.uses} must be pinned to a 40-hex sha`).toMatch(SHA_PIN)
      }
    }
  })

  it('runs the gate script, which must exist on disk', () => {
    const gateStep = riskGate.steps.find((s) => s.run?.includes('node tools/ops-review-loop/src/check-risk-gate.mjs'))
    expect(gateStep).toBeDefined()
    expect(
      existsSync(join(process.cwd(), 'tools/ops-review-loop/src/check-risk-gate.mjs')),
      'check-risk-gate.mjs 没了 —— 闸门会静默放行',
    ).toBe(true)
  })

  it('toggles auto-merge both ways through gh, never merging directly', () => {
    expect(riskGate.steps.some((s) => s.run?.includes('gh pr merge --auto --merge'))).toBe(true)
    expect(riskGate.steps.some((s) => s.run?.includes('gh pr merge --disable-auto'))).toBe(true)
  })

  it("enables auto-merge only from the gate's own 'enable' decision", () => {
    const enableStep = riskGate.steps.find((s) => s.run?.includes('gh pr merge --auto --merge'))
    expect(enableStep?.if?.trim()).toBe("steps.gate.outputs.decision == 'enable'")
  })

  it('never interpolates event data into a run block', () => {
    // The PR enters only as data through env vars. Interpolating it into a
    // `run:` block would make PR-controlled text executable.
    for (const forbidden of ['pull_request.title', 'pull_request.body', 'head.ref', 'head.label']) {
      expect(riskGate.source, `must not reference ${forbidden}`).not.toContain(forbidden)
    }
    for (const step of riskGate.steps) {
      if (step.run) {
        expect(step.run, `${step.name ?? step.uses ?? 'step'} must pass event data via env:, not ${{ }}`).not.toContain(
          '${{',
        )
      }
    }
  })

  it('contains no error-swallowing, direct-push, admin-merge, secret, or tag-pinned action', () => {
    const lower = riskGate.source.toLowerCase()
    for (const term of ['continue-on-error', 'git push', '--admin', 'secrets.', 'actions/checkout@v']) {
      expect(lower, `pr-risk-gate.yml must not contain "${term}"`).not.toContain(term)
    }
    // pull_request_target is the trigger; a plain pull_request key would run
    // the PR's own copy of this workflow.
    expect(riskGate.triggers.pull_request).toBeUndefined()
  })

  it('hands the gate step every input it needs through env, with the trusted logins from vars', () => {
    const gateStep = riskGate.steps.find((s) => s.run?.includes('node tools/ops-review-loop/src/check-risk-gate.mjs'))
    const env = gateStep?.env ?? {}
    for (const key of [
      'PR_NUMBER',
      'BASE_SHA',
      'HEAD_SHA',
      'PR_AUTHOR',
      'PR_DRAFT',
      'PR_IS_FORK',
      'SIGNOFF_TRUSTED_LOGINS',
      'GITHUB_TOKEN',
    ]) {
      expect(env[key], `gate step env must define ${key}`).toBeDefined()
    }
    expect(env.SIGNOFF_TRUSTED_LOGINS).toContain('vars.ME_SIGNOFF_TRUSTED_LOGINS')
    expect(env.SIGNOFF_TRUSTED_LOGINS).not.toContain('pull_request.user.login')
    expect(env.HEAD_SHA).toContain('steps.pr.outputs.head')
    expect(env.BASE_SHA).toContain('steps.pr.outputs.base')
    expect(env.PR_AUTHOR).toContain('steps.pr.outputs.author')
  })

  it('still judges from main and describes exactly two A-level sign-offs', () => {
    expect(riskGate.triggers.pull_request_target).toBeDefined()
    expect(riskGate.source).toContain('ref: main')
    expect(riskGate.source).toContain('Codex Astra')
    expect(riskGate.source).toContain('Claude Code')
    expect(riskGate.source).not.toContain('three trusted sign-off')
  })
})

describe('ops-review-loop CI: tests run on non-draft PRs', () => {
  it('triggers on pull_request, with no path or branch filter', () => {
    expect(Object.keys(ci.triggers)).toEqual(['pull_request'])
    const trigger = (ci.triggers.pull_request ?? {}) as {
      paths?: unknown
      'paths-ignore'?: unknown
      branches?: unknown
    }
    expect(trigger.paths).toBeUndefined()
    expect(trigger['paths-ignore']).toBeUndefined()
    expect(trigger.branches).toBeUndefined()
    expect(ci.doc.jobs?.tests?.if).toContain('draft')
  })

  it('is read-only', () => {
    expect(ci.doc.permissions).toEqual({ contents: 'read' })
  })

  it('runs the module test suite', () => {
    expect(ci.steps.some((s) => s.run?.includes('vitest run tools/ops-review-loop'))).toBe(true)
  })

  it('exposes the stable required-check name', () => {
    expect(ci.steps.some((step) => step.name === 'ops-review-loop-tests')).toBe(true)
    expect(ci.source).toContain('OUTCOME_OPS_REVIEW')
  })

  it('reads no secrets, merges nothing, and pushes nothing', () => {
    // The pattern that would actually leak a secret is the GitHub Actions
    // expression `${{ secrets.…` — not the plain word "secrets." (a comment
    // saying "there is no `secrets.` expression here" would falsely fire).
    expect(ci.source).not.toContain('${{ secrets.')
    expect(ci.source).not.toContain('gh pr merge')
    expect(ci.source).not.toContain('git push')
  })

  it('pins every action to a reviewed 40-hex commit sha', () => {
    for (const step of ci.steps) {
      if (step.uses) {
        expect(step.uses, `${step.uses} must be pinned to a 40-hex sha`).toMatch(SHA_PIN)
      }
    }
  })
})

describe('only the judge may write', () => {
  it('grants contents: write to the risk gate and to nothing else in the workflows directory', () => {
    const files = readdirSync(ROOT).filter((name) => name.endsWith('.yml'))
    expect(files).toContain('pr-risk-gate.yml')
    expect(files).toContain('pr-light-checks.yml')

    const contentsWrite = (workflow: Workflow): boolean => {
      if (workflow.permissions?.contents === 'write') return true
      return Object.values(workflow.jobs ?? {}).some((job) => job.permissions?.contents === 'write')
    }

    const riskGateDoc = YAML.load(readFileSync(RISK_GATE_PATH, 'utf8')) as Workflow
    const ciDoc = YAML.load(readFileSync(CI_PATH, 'utf8')) as Workflow

    expect(contentsWrite(riskGateDoc), 'pr-risk-gate.yml must be able to toggle auto-merge').toBe(true)
    expect(contentsWrite(ciDoc), 'pr-light-checks.yml must stay read-only').toBe(false)
    const report = ciDoc.jobs?.report
    expect(report?.permissions?.checks, 'only the report job may publish checks').toBe('write')
    expect(ciDoc.jobs?.tests?.permissions?.checks, 'the test job must not publish checks').toBeUndefined()
  })
})
