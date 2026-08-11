/**
 * Structural proof for ME2-OPS02's "Required validation" list, items 1-5:
 * YAML syntax, same-repo/base/branch guards, dedup, the 3-round stop, and the
 * absence of any merge/deploy/migration operation. Item 6 (whether the native
 * Codex GitHub App accepts a bot-authored "@codex review" comment) cannot be
 * proven offline — see ops-codex-smoke-test.yml and the PR description.
 *
 * Mirrors the style of tools/ai-orchestrator/tests/workflow-supply-chain.test.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const requireFromHere = createRequire(import.meta.url)
const YAML = requireFromHere('js-yaml') as { load(input: string): unknown }

const ROOT = join(process.cwd(), '.github/workflows')
const REQUEST_PATH = join(ROOT, 'ops-codex-request-review.yml')
const FIX_PATH = join(ROOT, 'ops-codex-to-claude-fix.yml')
const SMOKE_PATH = join(ROOT, 'ops-codex-smoke-test.yml')

interface WorkflowStep {
  id?: string
  uses?: string
  name?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
}
interface WorkflowJob {
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

const request = load(REQUEST_PATH)
const fix = load(FIX_PATH)
const smoke = load(SMOKE_PATH)
const all = [request, fix, smoke]

const FORBIDDEN_WRITE_SCOPES = ['workflows', 'actions', 'administration', 'deployments', 'packages', 'security-events']
const DANGEROUS_SUBSTRINGS = [
  'gh pr merge',
  'git push --force',
  'push -f ',
  'pr merge',
  'apply_migration',
  'supabase db push',
  'supabase migration',
  '--auto-merge',
  'auto-merge',
  'ready-for-review',
  'ready_for_review',
]

describe('every ops-codex-loop workflow parses as YAML with a real trigger', () => {
  it.each(all.map((w) => [w.path, w] as const))('%s', (_path, workflow) => {
    expect(workflow.doc).toBeTruthy()
    expect(Object.keys(workflow.triggers).length).toBeGreaterThan(0)
  })
})

describe('every ops-codex-loop workflow declares least-privilege permissions', () => {
  it.each(all.map((w) => [w.path, w] as const))('%s never grants a forbidden write scope', (_path, workflow) => {
    expect(workflow.doc.permissions).toBeDefined()
    for (const scope of FORBIDDEN_WRITE_SCOPES) {
      expect(workflow.doc.permissions?.[scope]).not.toBe('write')
    }
  })
})

describe('no workflow contains a merge, deploy, or migration operation', () => {
  it.each(all.map((w) => [w.path, w] as const))('%s', (_path, workflow) => {
    const lower = workflow.source.toLowerCase()
    for (const term of DANGEROUS_SUBSTRINGS) {
      expect(lower, `${workflow.path} must not contain "${term}"`).not.toContain(term)
    }
  })
})

describe('the request-review workflow', () => {
  it('triggers only on pull_request opened/synchronize/reopened', () => {
    expect(Object.keys(request.triggers)).toEqual(['pull_request'])
    expect((request.triggers.pull_request as { types: string[] }).types).toEqual([
      'opened',
      'synchronize',
      'reopened',
    ])
  })

  it('guards same-repo, base=main, and the claude/me2- branch prefix', () => {
    const guard = Object.values(request.doc.jobs ?? {})[0]?.if ?? ''
    expect(guard).toContain('head.repo.full_name == github.repository')
    expect(guard).toContain("base.ref == 'main'")
    expect(guard).toContain("startsWith(github.event.pull_request.head.ref, 'claude/me2-')")
  })

  it('checks out the control-plane script from main, not the PR head', () => {
    const checkout = request.steps.find((s) => s.uses?.startsWith('actions/checkout'))
    expect(checkout?.with?.ref).toBe('main')
  })

  it('has no contents: write', () => {
    expect(request.doc.permissions?.contents).not.toBe('write')
  })
})

describe('the codex-to-claude-fix workflow', () => {
  it('triggers only on pull_request_review submitted', () => {
    expect(Object.keys(fix.triggers)).toEqual(['pull_request_review'])
    expect((fix.triggers.pull_request_review as { types: string[] }).types).toEqual(['submitted'])
  })

  it('guards the Codex bot actor, same-repo, base=main, and the claude/me2- branch prefix', () => {
    const guard = Object.values(fix.doc.jobs ?? {})[0]?.if ?? ''
    expect(guard).toContain('chatgpt-codex-connector')
    expect(guard).toContain('head.repo.full_name == github.repository')
    expect(guard).toContain("base.ref == 'main'")
    expect(guard).toContain("startsWith(github.event.pull_request.head.ref, 'claude/me2-')")
  })

  it('never grants contents: write to the ambient GITHUB_TOKEN', () => {
    // claude-code-action pushes through its own Claude GitHub App token, not
    // this workflow's GITHUB_TOKEN — see the in-file comment for why.
    expect(fix.doc.permissions?.contents).not.toBe('write')
  })

  it('only invokes claude-code-action when the plan step said dispatch-fix', () => {
    const claudeStep = fix.steps.find((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    expect(claudeStep?.if).toBe("steps.plan.outputs.action == 'dispatch-fix'")
  })

  it('records the fix round outcome after the Claude step, on success or failure', () => {
    // Codex finding (PR #906, P2): the fix-dispatched marker used to be
    // written before the Claude Action step ran, so a failure permanently
    // consumed a round. This step must run unconditionally (always()) after
    // it and read that step's real outcome.
    const outcomeStep = fix.steps.find((s) => s.run?.includes('mark-fix-outcome.mjs'))
    expect(outcomeStep?.if).toBe("always() && steps.plan.outputs.action == 'dispatch-fix'")
  })

  it('gives the Claude Action step an id so the outcome step can read its result', () => {
    const claudeStep = fix.steps.find((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    expect(claudeStep?.id).toBe('claude')
  })

  it('runs the outcome step after the Claude Action step, not before', () => {
    const claudeIndex = fix.steps.findIndex((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    const outcomeIndex = fix.steps.findIndex((s) => s.run?.includes('mark-fix-outcome.mjs'))
    expect(claudeIndex).toBeGreaterThanOrEqual(0)
    expect(outcomeIndex).toBeGreaterThan(claudeIndex)
  })

  it('checks out the control-plane script from main, not the PR head', () => {
    const checkout = fix.steps.find((s) => s.uses?.startsWith('actions/checkout'))
    expect(checkout?.with?.ref).toBe('main')
  })

  it('serialises per PR so the check-then-act dedup cannot race itself', () => {
    expect(fix.doc.concurrency?.group).toContain('github.event.pull_request.number')
    expect(fix.doc.concurrency?.['cancel-in-progress']).toBe(false)
  })
})

describe('the smoke-test workflow', () => {
  it('is workflow_dispatch only', () => {
    expect(Object.keys(smoke.triggers)).toEqual(['workflow_dispatch'])
  })

  it('requires a pr_number input', () => {
    const dispatch = smoke.triggers.workflow_dispatch as { inputs?: Record<string, { required?: boolean }> }
    expect(dispatch.inputs?.pr_number?.required).toBe(true)
  })
})

describe('the round cap is 3 in the source that actually enforces it', () => {
  it('handle-review.mjs defines MAX_ROUNDS = 3', () => {
    const source = readFileSync(join(process.cwd(), 'tools/ops-review-loop/src/handle-review.mjs'), 'utf8')
    expect(source).toMatch(/const MAX_ROUNDS = 3\b/)
  })
})
