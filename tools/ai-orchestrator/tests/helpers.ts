/**
 * Shared fixtures. Deliberately not named `*.test.ts` so vitest does not collect
 * it as a suite.
 *
 * The harness keeps the model's self-report and the authoritative record as two
 * separate knobs (`implementerScript` vs `workspace` / `telemetry`), because most
 * of what these tests need to prove is what happens when the two disagree.
 */

import { InMemoryGitHubClient } from '../src/adapters/github/memory-client'
import { MockImplementerProvider } from '../src/adapters/claude/mock-implementer'
import type { MockImplementerStep } from '../src/adapters/claude/mock-implementer'
import { MockReviewerProvider } from '../src/adapters/openai/mock-reviewer'
import type { MockReviewerStep } from '../src/adapters/openai/mock-reviewer'
import { StaticWorkspaceInspector } from '../src/adapters/workspace/inspector'
import type { WorkspaceState } from '../src/adapters/workspace/inspector'
import {
  ALLOWED_AUTHORIZERS,
  PERMITTED_SIDE_EFFECT_CLASSES,
  SCAFFOLD_LEASE_TTL_MS,
  SCAFFOLD_LIMITS,
  TRUSTED_LEDGER_AUTHORS,
  createScaffoldAuthorization,
  createScaffoldRun,
} from '../src/config/scaffold-config'
import type { OrchestrationRun, RunMode, WorkPackageAuthorization } from '../src/domain/schema'
import { StaticIntegrityChecker } from '../src/policy/protected-paths'
import type { Clock, RunnerDeps, RunnerInput } from '../src/runner'

export const FIXED_NOW = new Date('2026-08-07T00:00:00.000Z')

export function fixedClock(now: Date = FIXED_NOW): Clock {
  return { now: () => now }
}

/**
 * A run that is both enabled and provably exclusive.
 *
 * The exclusivity half is not decoration: without a verified GitHub Actions
 * concurrency context the runner refuses to call a provider at all, because the
 * Issue-comment lease cannot stop two runners from both paying for a call.
 */
export const ENABLED_ENV = {
  ME2_ORCHESTRATOR_ENABLED: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '1234567',
  ME2_CONCURRENCY_GROUP: 'me2-orchestrator-issue-860',
} as const

/** The in-scope file every default fixture pretends to have changed. */
export const IN_SCOPE_FILE = 'docs/specs/2026-08-07-ai-orchestrator-v0.1.md'

export function reviewerOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdict: 'REQUEST_CHANGES',
    summary: 'The budget check runs after the money is already gone.',
    findings: [
      {
        severity: 'blocker',
        evidence: 'tools/ai-orchestrator/src/policy/policy.ts:checkBudget',
        source_ref: 'policy.ts',
        reasoning: 'A cap compared only against settled spend can be crossed by the next call.',
      },
    ],
    acceptance_criteria: ['A turn may only start when a full reservation still fits'],
    allowed_next_scope: { allowed_paths: ['docs/specs/**'], notes: null },
    prohibited_next_actions: ['merge', 'deploy'],
    human_question: null,
    ...overrides,
  }
}

export function implementerOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conclusion: 'Reserved the turn cost before the call and reconciled it after.',
    repo_evidence: ['docs/specs/2026-08-07-ai-orchestrator-v0.1.md:§7'],
    files_changed: [IN_SCOPE_FILE],
    tests_run: [{ command: 'npx vitest run tools/ai-orchestrator', passed: 12, failed: 0, note: null }],
    baseline_comparison: 'baseline on this commit: 12 passed / 0 failed. No new failures.',
    remaining_risks: ['Lease TTL is a guess until we see real runner durations.'],
    requested_next_scope: [],
    policy_exceptions: [],
    tools_used: ['Read', 'Edit'],
    commit_evidence: null,
    ...overrides,
  }
}

/**
 * A workspace capture. Fingerprints are what make round-over-round deltas work,
 * so the helper takes paths and turns each into a distinct fingerprint unless one
 * is given explicitly.
 */
export function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    head_sha: 'base000',
    branch: 'claude/x',
    remote: { ref: 'origin/claude/x', head_sha: 'remote000' },
    remote_readable: true,
    file_fingerprints: {},
    pull_request: null,
    source: 'git:diff+status+hash-object',
    ...overrides,
  }
}

/** Shorthand: `fingerprints(['a.ts', 'b.ts'], 'v1')` -> `{ 'a.ts': 'v1', ... }`. */
export function fingerprints(
  paths: readonly string[],
  version = 'v1'
): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [path, `${path}@${version}`]))
}

/** An implementer turn that changed nothing — useful for multi-round loop tests. */
export function quietImplementerOutput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return implementerOutput({ files_changed: [], commit_evidence: null, ...overrides })
}

/** A workspace that never moves, so every round's delta is empty. */
export function quietCaptures(): WorkspaceState[] {
  return [workspaceState({ file_fingerprints: {} })]
}

/** The pre-call and post-call captures for a turn that edits IN_SCOPE_FILE once. */
export function defaultCaptures(): WorkspaceState[] {
  return [
    workspaceState({ file_fingerprints: {} }),
    workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE]) }),
  ]
}

/**
 * The default capture sequence for a run, given who takes the first turn.
 *
 * **Every** turn consumes two captures now, not only the implementer's: the
 * runner snapshots the workspace around a reviewer turn too, because that is what
 * proves the reviewer was read-only rather than merely described as read-only.
 *
 * So a reviewer-first fixture has to open with a quiet pair. A reviewer whose
 * pair straddled the implementer's edit would look like it had written the file
 * itself — which is precisely the violation the check exists to catch, and a
 * fixture that trips it on every honest run is how a check gets deleted.
 */
export function defaultCapturesFor(mode: RunMode): WorkspaceState[] {
  const quiet = workspaceState({ file_fingerprints: {} })
  return mode === 'IMPLEMENT' ? defaultCaptures() : [quiet, quiet, ...defaultCaptures()]
}

export interface Harness {
  github: InMemoryGitHubClient
  reviewer: MockReviewerProvider
  implementer: MockImplementerProvider
  deps: RunnerDeps
  input: RunnerInput
  run: OrchestrationRun
  authorization: WorkPackageAuthorization
}

export function makeHarness(options?: {
  reviewerScript?: readonly MockReviewerStep[]
  implementerScript?: readonly MockImplementerStep[]
  now?: Date
  dryRun?: boolean
  runOverrides?: Partial<OrchestrationRun>
  /**
   * Bends the signed grant. Its `max_rounds` and `cost_cap_usd` are hard ceilings
   * alongside the run's and the deployment's, so a test that means to exercise a
   * *different* ceiling has to widen this one or it will bind first.
   */
  authorizationOverrides?: Partial<WorkPackageAuthorization>
  inputOverrides?: Partial<RunnerInput>
  depsOverrides?: Partial<RunnerDeps>
  labels?: readonly string[]
  /**
   * Successive workspace captures. The runner takes one before **every** provider
   * call and one after — reviewer turns included — so a single turn of either
   * actor consumes two entries. See `defaultCapturesFor`.
   */
  workspace?: readonly WorkspaceState[]
  /** Protected paths the integrity checker finds drifted. */
  drift?: readonly string[]
}): Harness {
  const now = options?.now ?? FIXED_NOW
  const github = new InMemoryGitHubClient({ labels: options?.labels })
  const reviewer = new MockReviewerProvider(
    options?.reviewerScript ?? [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }]
  )
  const implementer = new MockImplementerProvider(
    options?.implementerScript ?? [{ output: implementerOutput() }]
  )

  const authorization: WorkPackageAuthorization = {
    ...createScaffoldAuthorization({
      workPackageId: 'wp-860-scaffold',
      now,
      authorizationSource: 'github-issue#860',
    }),
    ...options?.authorizationOverrides,
  }

  const run: OrchestrationRun = {
    ...createScaffoldRun({
      runId: 'run-test-001',
      issueNumber: 860,
      mode: 'REVIEW',
      workPackageId: authorization.work_package_id,
      now,
    }),
    ...options?.runOverrides,
  }

  const input: RunnerInput = {
    run,
    authorization,
    limits: SCAFFOLD_LIMITS,
    dryRun: options?.dryRun ?? false,
    workflowEnabledInput: true,
    env: { ...ENABLED_ENV },
    trustedAuthors: [...TRUSTED_LEDGER_AUTHORS],
    allowedAuthorizers: [...ALLOWED_AUTHORIZERS],
    holder: 'test-holder',
    leaseTtlMs: SCAFFOLD_LEASE_TTL_MS,
    permittedSideEffectClasses: [...PERMITTED_SIDE_EFFECT_CLASSES],
    taskBrief: 'Review the v0.1 orchestrator scaffold.',
    untrusted: [{ source: 'issue#860', text: 'Scaffold the orchestrator. Do not enable anything.' }],
    ...options?.inputOverrides,
  }

  const deps: RunnerDeps = {
    github,
    reviewer,
    implementer,
    workspace: new StaticWorkspaceInspector(options?.workspace ?? defaultCapturesFor(run.mode)),
    integrity: new StaticIntegrityChecker(options?.drift ?? []),
    clock: fixedClock(now),
    ...options?.depsOverrides,
  }

  return { github, reviewer, implementer, deps, input, run, authorization }
}
