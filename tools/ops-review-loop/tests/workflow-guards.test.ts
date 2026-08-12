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
// Banned in every workflow, no exceptions. Nothing in this loop has ever had a
// reason to force-push, apply a migration, or flip a draft to ready-for-review.
const DANGEROUS_SUBSTRINGS = [
  'git push --force',
  'push -f ',
  'apply_migration',
  'supabase db push',
  'supabase migration',
  'ready-for-review',
  'ready_for_review',
]

// Merge-related terms. Banned everywhere EXCEPT ops-codex-to-claude-fix.yml,
// which gained the ability to merge on 2026-08-12 by explicit Product Owner
// decision. The exemption is one named file rather than a relaxed global rule,
// so a merge capability appearing in any *other* workflow is still a failure.
const MERGE_SUBSTRINGS = ['gh pr merge', 'pr merge', '--auto-merge', 'auto-merge']
const MERGE_EXEMPT_WORKFLOW = 'ops-codex-to-claude-fix.yml'

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

describe('no workflow contains a force-push, migration, or ready-for-review operation', () => {
  it.each(all.map((w) => [w.path, w] as const))('%s', (_path, workflow) => {
    const lower = workflow.source.toLowerCase()
    for (const term of DANGEROUS_SUBSTRINGS) {
      expect(lower, `${workflow.path} must not contain "${term}"`).not.toContain(term)
    }
  })
})

describe('only the one exempted workflow may mention merging', () => {
  it.each(all.filter((w) => !w.path.endsWith(MERGE_EXEMPT_WORKFLOW)).map((w) => [w.path, w] as const))(
    '%s',
    (_path, workflow) => {
      const lower = workflow.source.toLowerCase()
      for (const term of MERGE_SUBSTRINGS) {
        expect(lower, `${workflow.path} must not contain "${term}"`).not.toContain(term)
      }
    },
  )

  it('the exemption is a single named file, so a second merging workflow fails this suite', () => {
    const exempt = all.filter((w) => w.path.endsWith(MERGE_EXEMPT_WORKFLOW))
    expect(exempt).toHaveLength(1)
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

  it('matches the Codex bot login exactly, never as a substring', () => {
    // Codex finding (PR #931, P1): `contains(login, 'chatgpt-codex-connector')`
    // also matches any account whose name merely embeds that string. Once a
    // clean review can trigger an unattended production merge, "looks close
    // enough to the reviewer's name" is an authorisation decision. The real
    // login is confirmed from live payloads, so match it exactly.
    const guard = Object.values(fix.doc.jobs ?? {})[0]?.if ?? ''
    expect(guard).toContain("github.event.review.user.login == 'chatgpt-codex-connector[bot]'")
    expect(guard).not.toContain('contains(github.event.review.user.login')
  })

  it('guards same-repo, base=main, and the claude/me2- branch prefix', () => {
    const guard = Object.values(fix.doc.jobs ?? {})[0]?.if ?? ''
    expect(guard).toContain('head.repo.full_name == github.repository')
    expect(guard).toContain("base.ref == 'main'")
    expect(guard).toContain("startsWith(github.event.pull_request.head.ref, 'claude/me2-')")
  })

  it('keeps contents: write out of the job that runs the third-party action', () => {
    // Codex finding (PR #931, P1). The review/fix job runs
    // anthropics/claude-code-action. A job-level `contents: write` there would
    // hand that action repository write access through the ambient
    // GITHUB_TOKEN on every single run — including runs where no merge was ever
    // possible. Write scope belongs only to the isolated merge job.
    expect(fix.doc.permissions?.contents).not.toBe('write')
    const reviewJob = fix.doc.jobs?.['handle-review']
    expect(reviewJob?.permissions?.contents).not.toBe('write')
    const claudeStep = (reviewJob?.steps ?? []).find((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    expect(claudeStep, 'the third-party action must live in the read-only job').toBeDefined()
  })

  it('gives write scope to a merge job that runs nothing but the merge', () => {
    const mergeJob = fix.doc.jobs?.merge
    expect(mergeJob?.permissions?.contents).toBe('write')
    const steps = mergeJob?.steps ?? []
    // No model, no prompt, no third-party action sharing that scope.
    expect(steps.some((s) => s.uses?.startsWith('anthropics/'))).toBe(false)
    expect(steps.some((s) => s.run?.includes('merge-pr.mjs'))).toBe(true)
    expect(mergeJob?.if).toContain("needs.handle-review.outputs.action == 'auto-merge'")
  })

  it('re-reads the kill switch inside the merge job, not just the decision job', () => {
    // Codex finding (PR #931, P1): between the two jobs an admin can flip the
    // variable to false, and a check can be re-run back to failing — neither
    // changes the sha. The README promises the switch "takes effect
    // immediately"; only a last-moment re-read in the job holding write makes
    // that true.
    const mergeStep = (fix.doc.jobs?.merge?.steps ?? []).find((s) => s.run?.includes('merge-pr.mjs'))
    expect(mergeStep?.env?.AUTO_MERGE_ENABLED).toBe('${{ vars.OPS_AUTO_MERGE_ENABLED }}')
    const source = readFileSync(join(process.cwd(), 'tools/ops-review-loop/src/merge-pr.mjs'), 'utf8')
    expect(source).toContain("process.env.AUTO_MERGE_ENABLED !== 'true'")
    // and re-verifies the gates that can change without the sha changing.
    // Assert the guard EXPRESSION, not the identifier: `isEveryCheckGreen`
    // also appears on the import line, so a `toContain` on the bare name stays
    // green even when the check itself is gutted — the assertion would be
    // triggered by its own import.
    expect(source).toContain('if (!isEveryCheckGreen(await listCheckRunsForRef(token, owner, repo, sha)))')
    expect(source).toContain("pr_?.draft === true")
    expect(source).toContain('pr_?.head?.sha !== sha')
    // base is mutable without the sha moving, and the merge API follows the
    // base as it is at merge time (Codex finding PR #931, P2).
    expect(source).toContain("pr_?.base?.ref !== 'main'")
    expect(source).toContain('pr_?.base?.repo?.full_name')
  })

  it('pairs the merge capability with the kill switch', () => {
    const planStep = fix.steps.find((s) => s.run?.includes('handle-review.mjs'))
    expect(planStep?.env?.AUTO_MERGE_ENABLED).toBe('${{ vars.OPS_AUTO_MERGE_ENABLED }}')
  })

  it('reads the kill switch from a repository variable, never from a secret or a file in this repo', () => {
    // Workflow files are auto-mergeable now, so a switch stored in one could be
    // turned off by the very change it exists to stop. Repository variables sit
    // outside anything this loop's token can write.
    const planStep = fix.steps.find((s) => s.run?.includes('handle-review.mjs'))
    const switchExpr = planStep?.env?.AUTO_MERGE_ENABLED ?? ''
    expect(switchExpr).toContain('vars.')
    expect(switchExpr).not.toContain('secrets.')
    expect(switchExpr).not.toContain('inputs.')
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
    // claude-code-action blocks bot-triggered runs unless the bot is named
    // (observed on PR #936, 2026-08-12 04:54). '*' would let ANY bot able to
    // submit a review drive an automated code push into a branch — the actor
    // guard on the job would be the only thing left, and defence in depth is
    // the point of having both.
    const claudeStep = fix.steps.find((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    expect(claudeStep?.with?.allowed_bots).toBe('chatgpt-codex-connector')
    expect(String(claudeStep?.with?.allowed_bots)).not.toContain('*')
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
