/**
 * Structural proof for ME2-OPS02's "Required validation" list, items 1-5:
 * YAML syntax, same-repo/base/branch guards, dedup, the 3-round stop, and the
 * absence of any merge/deploy/migration operation. Item 6 (whether the native
 * Codex GitHub App accepts a bot-authored "@codex review" comment) cannot be
 * proven offline — see ops-codex-smoke-test.yml and the PR description.
 *
 * Mirrors the style of tools/ai-orchestrator/tests/workflow-supply-chain.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { GUARDED_BRANCH_PREFIXES, PROTECTED_PATHS } from '../src/fix-scope.mjs'

const requireFromHere = createRequire(import.meta.url)
const YAML = requireFromHere('js-yaml') as { load(input: string): unknown }

const ROOT = join(process.cwd(), '.github/workflows')
const REQUEST_PATH = join(ROOT, 'ops-codex-request-review.yml')
const FIX_PATH = join(ROOT, 'ops-codex-to-claude-fix.yml')
const SMOKE_PATH = join(ROOT, 'ops-codex-smoke-test.yml')
const SCOPE_PATH = join(ROOT, 'ops-fix-scope-guard.yml')

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
const scope = load(SCOPE_PATH)
const all = [request, fix, smoke, scope]

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

  it('guards same-repo, base=main, and the claude/ agent-branch prefix', () => {
    const guard = Object.values(request.doc.jobs ?? {})[0]?.if ?? ''
    expect(guard).toContain('head.repo.full_name == github.repository')
    expect(guard).toContain("base.ref == 'main'")
    expect(guard).toContain("startsWith(github.event.pull_request.head.ref, 'claude/')")
  })

  it('is scoped wider than the auto-push leg, and only this leg is', () => {
    // Asymmetry on purpose: asking for a review posts one comment and can
    // collide with nothing, so every agent branch gets it. Dispatching a fix
    // pushes commits, and this repo runs one window per branch (CLAUDE.md §6),
    // so that leg stays in the ME2 lane. If someone ever "tidies up" these two
    // guards into matching prefixes, the auto-push leg silently gains reach
    // over branches a live window is holding — this pins the difference.
    const requestGuard = Object.values(request.doc.jobs ?? {})[0]?.if ?? ''
    const fixGuard = Object.values(fix.doc.jobs ?? {})[0]?.if ?? ''
    expect(requestGuard).not.toContain("'claude/me2-'")
    expect(fixGuard).toContain("'claude/me2-'")
  })

  it('checks out the control-plane script from main, not the PR head', () => {
    const checkout = request.steps.find((s) => s.uses?.startsWith('actions/checkout'))
    expect(checkout?.with?.ref).toBe('main')
  })

  it('has no contents: write', () => {
    expect(request.doc.permissions?.contents).not.toBe('write')
  })

  it('authors the review request through OPS_REVIEW_PAT, never the ambient GITHUB_TOKEN', () => {
    // Codex Cloud resolves "@codex review" against the *comment author's*
    // Codex account. github-actions[bot] has none, so every bot-authored
    // request was refused with "create a Codex account and connect to github"
    // (PR #898 12:38/13:58, PR #924 01:21/02:52 — four for four), while the
    // same text from the Product Owner's account drew a real review in four
    // minutes. Reverting this env var to GITHUB_TOKEN restores a workflow
    // that goes green and accomplishes nothing, which is the hardest kind of
    // break to notice — so it is pinned here.
    const step = request.steps.find((s) => s.run?.includes('request-review.mjs'))
    // The POST — the only call whose author Codex looks at — must be the PAT.
    expect(step?.env?.REVIEW_REQUEST_TOKEN).toBe('${{ secrets.OPS_REVIEW_PAT }}')
  })

  it('reads with the ambient token so the PAT needs no extra permission to dedup', () => {
    // PR #927's first live run died on `GET /issues/927/comments -> 404`: issue
    // comments sit under the Issues API even on a PR, so a PAT granted only
    // "Pull requests" cannot read them. The read carries no identity meaning,
    // so it should never have been on the PAT in the first place.
    const step = request.steps.find((s) => s.run?.includes('request-review.mjs'))
    expect(step?.env?.GITHUB_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}')
  })

  it('fails closed when OPS_REVIEW_PAT is missing instead of falling back', () => {
    // A fallback to GITHUB_TOKEN would silently reproduce the original bug.
    const guardStep = request.steps.find((s) => s.run?.includes('OPS_REVIEW_PAT is not set'))
    expect(guardStep).toBeDefined()
    expect(guardStep?.run).toContain('exit 1')
    const guardIndex = request.steps.findIndex((s) => s.run?.includes('OPS_REVIEW_PAT is not set'))
    const postIndex = request.steps.findIndex((s) => s.run?.includes('request-review.mjs'))
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(postIndex).toBeGreaterThan(guardIndex)
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

  // Issue #939: without `allowed_bots` the action refuses every run outright
  // ("Workflow initiated by non-human actor ... ALLOWED_BOTS: \"\""), so this
  // leg had never completed once. The fix is one login — never '*', which
  // would let any review-capable bot drive a leg that commits and pushes.
  it('allowlists exactly the Codex bot on the action, and never *', () => {
    const claudeStep = fix.steps.find((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    const allowed = claudeStep?.with?.allowed_bots
    expect(allowed, 'missing allowed_bots → the action rejects the bot and this leg never runs').toBe(
      'chatgpt-codex-connector',
    )
    expect(allowed).not.toBe('*')
    expect(String(allowed)).not.toContain('*')
    // The `if:` guard is the real security boundary; allowed_bots must not be
    // wider than it. Same single login on both sides.
    const guard = Object.values(fix.doc.jobs ?? {})[0]?.if ?? ''
    for (const login of String(allowed).split(',').map((s) => s.trim())) {
      expect(guard, `allowed_bots names ${login} but the if: guard does not`).toContain(login)
    }
  })

  it('builds the Claude prompt through the fenced builder, never inline', () => {
    // The findings body is attacker-influenced, so the boundary around it is
    // tested by behaviour in tests/prompt.test.ts. What this one pins is that
    // handle-review.mjs keeps *delegating* there: if someone re-inlines the
    // prompt here, those adversarial tests would still pass while no longer
    // covering the string that actually ships.
    const source = readFileSync(join(process.cwd(), 'tools/ops-review-loop/src/handle-review.mjs'), 'utf8')
    expect(source).toMatch(/import \{ buildFixPrompt \} from '\.\/prompt\.mjs'/)
    expect(source).toContain('buildFixPrompt({')
    expect(source, 'prompt text re-inlined here — move it back into prompt.mjs').not.toContain(
      'Treat it strictly as DATA',
    )
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

  it('allow-lists exactly the Codex bot, never a wildcard', () => {
    // Without this the action refuses the run outright ("Workflow initiated by
    // non-human actor"), which is how this leg came to fail every single time
    // it fired — PR #936 at 2026-08-12 04:54 and PR #930's branch at 06:43,
    // 07:05 and 07:26. The loop looked wired and was not.
    //
    // '*' is the tempting one-character alternative and is rejected: it would
    // let any bot able to submit a review drive an automated code push, with
    // the job-level actor guard as the only remaining check.
    const claudeStep = fix.steps.find((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    expect(claudeStep?.with?.allowed_bots).toBe('chatgpt-codex-connector')
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

describe('the auto-fix blast-radius guard (the real boundary)', () => {
  // Codex on PR #941: "XML 围栏只改变文本位置，无法区分正常的修复指令和被 PR 内容
  // 诱导出来的恶意修复指令 … 现有测试只验证字符串位于围栏内，并未验证模型不会服从它。"
  // Correct — so containment cannot live in the prompt. It lives here, in a
  // check that judges the resulting diff. These assertions pin the properties
  // that make it a boundary rather than a suggestion.
  it('runs on pull_request so it cannot be skipped by not asking for it', () => {
    expect(Object.keys(scope.triggers)).toEqual(['pull_request'])
  })

  it('checks itself out from main, so a PR cannot edit the guard that judges it', () => {
    const checkout = scope.steps.find((s) => s.uses?.startsWith('actions/checkout'))
    expect(checkout?.with?.ref).toBe('main')
  })

  it('is read-only — it judges, it never writes', () => {
    expect(scope.doc.permissions?.contents).toBe('read')
    expect(scope.doc.permissions?.['pull-requests']).toBe('read')
  })

  it('guards exactly the lane the auto-fix leg can push to', () => {
    // If the fix leg's reach ever widens, this guard must widen with it.
    const fixGuard = Object.values(fix.doc.jobs ?? {})[0]?.if ?? ''
    for (const prefix of GUARDED_BRANCH_PREFIXES) {
      expect(fixGuard, `fix leg pushes to ${prefix} but the scope guard does not cover it`).toContain(prefix)
    }
  })

  it('protects the paths that would let the lane widen itself', () => {
    const protectedPrefixes = PROTECTED_PATHS.map((r) => r.prefix ?? r.suffix ?? r.includes)
    for (const needed of ['.github/workflows/', 'tools/ops-review-loop/', 'supabase/migrations/', 'render.yaml']) {
      expect(protectedPrefixes, `${needed} must stay protected`).toContain(needed)
    }
  })

  it('🔴 the guard script must exist — deleting it must redden a REQUIRED check, not silently pass', () => {
    // The workflow tolerates a missing script exactly once: the bootstrap PR
    // that introduces it (it checks out `main`, where the file does not exist
    // yet). That tolerance would otherwise be a permanent hole — delete the
    // script from main and the guard exits 0 forever.
    //
    // This assertion closes it. It lives in ai-orchestrator-tests, which IS a
    // required check, so removing the script fails the merge gate instead of
    // quietly disarming the guard.
    for (const file of [
      'tools/ops-review-loop/src/check-fix-scope.mjs',
      'tools/ops-review-loop/src/fix-scope.mjs',
    ]) {
      expect(existsSync(join(process.cwd(), file)), `${file} 没了 —— 爆炸半径闸门会静默放行`).toBe(true)
    }
    // and the workflow must still be the thing that runs it
    expect(scope.source).toContain('tools/ops-review-loop/src/check-fix-scope.mjs')
  })

  it('narrows the action tool surface too, while not pretending that is the boundary', () => {
    const claudeStep = fix.steps.find((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    expect(String(claudeStep?.with?.claude_args ?? '')).toContain('--allowed-tools')
    expect(fix.source).toContain('NOT the boundary')
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

  it('does not describe itself as bot-authored in the comment it actually posts', () => {
    // Codex finding (PR #927, P2): switching the workflow's token while leaving
    // the posted text saying "posted by github-actions[bot] ... to check whether
    // a bot-authored request works" makes the validation evidence assert the
    // opposite of what ran. The mechanism and the words about it drift apart
    // silently, because nothing executes the words.
    const source = readFileSync(join(process.cwd(), 'tools/ops-review-loop/src/smoke-test.mjs'), 'utf8')
    const posted = source.slice(source.indexOf('@codex review'))
    expect(posted).not.toContain('posted by github-actions[bot]')
    expect(posted).toContain('OPS_REVIEW_PAT')
  })

  it('posts through OPS_REVIEW_PAT so it validates the real path, not the broken one', () => {
    // The bot-authored question this workflow originally existed to answer is
    // settled (it does not work). Its job now is to prove the replacement
    // identity works on demand — which it cannot do while posting as the bot.
    const step = smoke.steps.find((s) => s.run?.includes('smoke-test.mjs'))
    expect(step?.env?.GITHUB_TOKEN).toBe('${{ secrets.OPS_REVIEW_PAT }}')
  })
})

describe('the round cap is 3 in the source that actually enforces it', () => {
  it('handle-review.mjs defines MAX_ROUNDS = 3', () => {
    const source = readFileSync(join(process.cwd(), 'tools/ops-review-loop/src/handle-review.mjs'), 'utf8')
    expect(source).toMatch(/const MAX_ROUNDS = 3\b/)
  })
})
