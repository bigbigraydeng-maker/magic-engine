/**
 * The concrete configuration the v0.1 scaffold runs with.
 *
 * Everything is parsed through the schemas at construction, so a bad constant
 * here fails at start-up rather than half-way through a run.
 *
 * Note what the work package does NOT grant: `tools/ai-orchestrator/**`.
 * The orchestrator is protected in full, and `workPackageScopeSchema` refuses to
 * parse an authorization that reaches into it — so this file physically cannot
 * hand the tool the keys to itself. Upgrading the orchestrator is a separate,
 * human-initiated, human-reviewed change (which is how this very file got here).
 */

import {
  ALWAYS_PROHIBITED_OPERATIONS,
  orchestrationRunSchema,
  workPackageAuthorizationSchema,
} from '../domain/schema'
import type {
  OrchestrationRun,
  RepositoryRef,
  RunMode,
  WorkPackageAuthorization,
} from '../domain/schema'
import { DEFAULT_LIMITS } from '../policy/policy'
import type { OrchestratorLimits } from '../policy/policy'

export const SCAFFOLD_REPOSITORY: RepositoryRef = {
  owner: 'bigbigraydeng-maker',
  repo: 'magic-engine',
}

/** Ledger markers are only trusted from these comment authors. */
export const TRUSTED_LEDGER_AUTHORS = ['me2-orchestrator-bot', 'github-actions[bot]'] as const

/** Only these logins may release a WAITING_HUMAN run. */
export const ALLOWED_AUTHORIZERS = ['bigbigraydeng-maker'] as const

/** v0.1 refuses to run a work package that can touch anything outside the repo. */
export const PERMITTED_SIDE_EFFECT_CLASSES = ['none', 'repo_local'] as const

export const SCAFFOLD_LIMITS: OrchestratorLimits = {
  ...DEFAULT_LIMITS,
  max_rounds: 6,
  cost_cap_usd: 2,
  max_turn_cost_usd: 0.5,
}

/**
 * Must exceed the **in-flight window** plus `lease_margin_ms`, or
 * `checkTimingInvariant` refuses to start the run.
 *
 * The in-flight window is `provider_timeout_ms` only when the provider proves it
 * cancels. Both real adapters declare `cancellation.supported = false`, so for
 * them it is `server_max_timeout_ms` (30 min) and this value is far too small —
 * which is the point: Enable has to raise it deliberately rather than inherit a
 * number sized for mocks.
 */
export const SCAFFOLD_LEASE_TTL_MS =
  SCAFFOLD_LIMITS.provider_timeout_ms + SCAFFOLD_LIMITS.lease_margin_ms + 60_000

export const SCAFFOLD_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Write',
  'Edit',
  'Bash(npm test*)',
  'Bash(npm run type-check*)',
  'Bash(git add*)',
  'Bash(git commit*)',
  'Bash(gh pr create*)',
] as const

export const SCAFFOLD_DISALLOWED_TOOLS = [
  'Bash(gh pr merge*)',
  // Pushing at all, not merely force-pushing. `can_push` is `z.literal(false)`:
  // publishing belongs to the deterministic publisher (spec §9b E1), which runs
  // after policy has passed. A tool the policy layer cannot verify the effect of
  // is not a tool this work package hands out.
  'Bash(git push*)',
  'Bash(git push --force*)',
  'Bash(git push -f*)',
  'Bash(npx supabase*)',
  'Bash(curl*)',
  'WebFetch',
  'WebSearch',
] as const

export function createScaffoldAuthorization(args: {
  workPackageId: string
  now: Date
  ttlMs?: number
  authorizedBy?: string
  authorizationSource: string
  /** Defaults to a design-docs-only scope. Never the orchestrator itself. */
  allowedPaths?: readonly string[]
}): WorkPackageAuthorization {
  return workPackageAuthorizationSchema.parse({
    work_package_id: args.workPackageId,
    scope: {
      allowed_paths: args.allowedPaths ?? ['docs/specs/**'],
      denied_paths: [
        'src/**',
        'supabase/**',
        'render.yaml',
        'package.json',
        'package-lock.json',
        'docs/ROADMAP.md',
        'CLAUDE.md',
      ],
      can_commit: true,
      can_push: false,
      can_open_draft_pr: true,
      can_merge: false,
      allowed_tools: [...SCAFFOLD_ALLOWED_TOOLS],
      disallowed_tools: [...SCAFFOLD_DISALLOWED_TOOLS],
    },
    prohibited_operations: [...ALWAYS_PROHIBITED_OPERATIONS],
    side_effect_class: 'repo_local',
    expires_at: new Date(args.now.getTime() + (args.ttlMs ?? 6 * 60 * 60 * 1000)).toISOString(),
    max_rounds: SCAFFOLD_LIMITS.max_rounds,
    cost_cap_usd: SCAFFOLD_LIMITS.cost_cap_usd,
    authorized_by: args.authorizedBy ?? ALLOWED_AUTHORIZERS[0],
    authorization_source: args.authorizationSource,
  })
}

export function createScaffoldRun(args: {
  runId: string
  issueNumber: number
  mode: RunMode
  workPackageId: string
  now: Date
  wallClockMs?: number
  repository?: RepositoryRef
}): OrchestrationRun {
  const nowIso = args.now.toISOString()
  return orchestrationRunSchema.parse({
    run_id: args.runId,
    repository: args.repository ?? SCAFFOLD_REPOSITORY,
    issue_number: args.issueNumber,
    mode: args.mode,
    state: 'READY',
    work_package_id: args.workPackageId,
    current_round: 0,
    max_rounds: SCAFFOLD_LIMITS.max_rounds,
    cumulative_cost_usd: 0,
    cost_cap_usd: SCAFFOLD_LIMITS.cost_cap_usd,
    invalid_output_count: 0,
    last_processed_comment_id: null,
    target_branch: null,
    pr_number: null,
    deadline_at: new Date(
      args.now.getTime() + (args.wallClockMs ?? SCAFFOLD_LIMITS.max_wall_clock_ms)
    ).toISOString(),
    stop_reason: null,
    created_at: nowIso,
    updated_at: nowIso,
  })
}
