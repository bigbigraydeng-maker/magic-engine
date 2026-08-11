import { describe, expect, it } from 'vitest'

import { workPackageAuthorizationSchema, workPackageScopeSchema } from '../src/domain/schema'
import type { AuthoritativeTurnFacts } from '../src/domain/schema'
import { computeBudgetLedger } from '../src/domain/budget'
import {
  ENABLE_ENV_VAR,
  KILL_SWITCH_LABEL,
  checkBudget,
  checkTimingInvariant,
  compareSelfReport,
  enforceAuthorizationWindow,
  enforceFileScope,
  enforceProtectedPaths,
  enforceSideEffectClass,
  enforceToolUse,
  evaluateImplementerTurn,
  evaluateKillSwitch,
} from '../src/policy/policy'
import { DEFAULT_LIMITS } from '../src/policy/policy'
import {
  PROTECTED_PATHS,
  globsOverlap,
  selectSelfModifyingPatterns,
} from '../src/policy/protected-paths'
import { matchesGlob, matchesWildcard } from '../src/policy/glob'
import {
  SCAFFOLD_LEASE_TTL_MS,
  SCAFFOLD_LIMITS,
  createScaffoldAuthorization,
  createScaffoldRun,
} from '../src/config/scaffold-config'
import { IN_SCOPE_FILE, implementerOutput } from './helpers'
import { implementerTurnOutputSchema } from '../src/domain/schema'

const NOW = new Date('2026-08-07T00:00:00.000Z')

const authorization = createScaffoldAuthorization({
  workPackageId: 'wp-860',
  now: NOW,
  authorizationSource: 'issue#860',
})

function facts(overrides: Partial<AuthoritativeTurnFacts> = {}): AuthoritativeTurnFacts {
  return {
    files_changed: [IN_SCOPE_FILE],
    cumulative_files_changed: [IN_SCOPE_FILE],
    tools_used: ['Read', 'Edit'],
    commit: null,
    pull_request: null,
    pull_request_opened_this_turn: false,
    pushed_this_turn: false,
    remote_head_delta: null,
    remote_facts_available: true,
    sources: { workspace: 'git:diff+status+hash-object', telemetry: 'mock:execution-log' },
    ...overrides,
  }
}

const emptyBudget = computeBudgetLedger([], 'r1', NOW)

describe('kill switch (default off)', () => {
  it('stops when the label is present, even if everything else says go', () => {
    const result = evaluateKillSwitch({
      workflowEnabledInput: true,
      env: { [ENABLE_ENV_VAR]: 'true' },
      issueLabels: [KILL_SWITCH_LABEL],
    })
    expect(result).toEqual({ stopped: true, reason: expect.stringContaining(KILL_SWITCH_LABEL) })
  })

  it('stops when the workflow input is false', () => {
    expect(
      evaluateKillSwitch({
        workflowEnabledInput: false,
        env: { [ENABLE_ENV_VAR]: 'true' },
        issueLabels: [],
      }).stopped
    ).toBe(true)
  })

  it.each(['', undefined, '1', 'yes', 'TRUE', 'True'])(
    'stops when %s is the env value (only the exact string "true" enables)',
    (value) => {
      expect(
        evaluateKillSwitch({
          workflowEnabledInput: true,
          env: { [ENABLE_ENV_VAR]: value },
          issueLabels: [],
        }).stopped
      ).toBe(true)
    }
  )

  it('runs only when all three agree', () => {
    expect(
      evaluateKillSwitch({
        workflowEnabledInput: true,
        env: { [ENABLE_ENV_VAR]: 'true' },
        issueLabels: ['enhancement'],
      })
    ).toEqual({ stopped: false, reason: null })
  })
})

describe('timing invariant — the anti-duplicate-spend precondition', () => {
  it('accepts the scaffold configuration', () => {
    expect(checkTimingInvariant(SCAFFOLD_LIMITS, SCAFFOLD_LEASE_TTL_MS).ok).toBe(true)
  })

  it('refuses a lease that could lapse while a call is in flight', () => {
    const result = checkTimingInvariant(SCAFFOLD_LIMITS, SCAFFOLD_LIMITS.provider_timeout_ms)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('duplicate paid call')
  })

  it('refuses a lease that leaves no margin at all', () => {
    const ttl = SCAFFOLD_LIMITS.provider_timeout_ms + SCAFFOLD_LIMITS.lease_margin_ms - 1
    expect(checkTimingInvariant(SCAFFOLD_LIMITS, ttl).ok).toBe(false)
  })

  it('accepts exactly timeout + margin', () => {
    const ttl = SCAFFOLD_LIMITS.provider_timeout_ms + SCAFFOLD_LIMITS.lease_margin_ms
    expect(checkTimingInvariant(SCAFFOLD_LIMITS, ttl).ok).toBe(true)
  })

  it('refuses a per-turn reservation larger than the whole cap', () => {
    const result = checkTimingInvariant(
      { ...DEFAULT_LIMITS, cost_cap_usd: 0.1, max_turn_cost_usd: 0.5 },
      SCAFFOLD_LEASE_TTL_MS
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('exceeds cost_cap_usd')
  })

  it('refuses a zero reservation, which would reserve nothing', () => {
    expect(
      checkTimingInvariant({ ...DEFAULT_LIMITS, max_turn_cost_usd: 0 }, SCAFFOLD_LEASE_TTL_MS).ok
    ).toBe(false)
  })
})

describe('budget is a ceiling, not a tripwire', () => {
  const run = createScaffoldRun({
    runId: 'r1',
    issueNumber: 860,
    mode: 'REVIEW',
    workPackageId: 'wp-860',
    now: NOW,
  })

  it('passes when a full reservation still fits', () => {
    expect(checkBudget(run, authorization, SCAFFOLD_LIMITS, emptyBudget, NOW).ok).toBe(true)
  })

  it('stops before the last turn that would cross the cap', () => {
    // $1.75 committed of a $2.00 cap, and a turn reserves $0.50: $0.25 left is not
    // enough, so the turn must not start even though nothing has overspent yet.
    const ledger = computeBudgetLedger(
      [
        {
          schema_version: 'v1',
          run_id: run.run_id,
          at: NOW.toISOString(),
          event: 'turn_completed',
          actor: 'gpt_reviewer',
          round: 1,
          idempotency_key: 'k1',
          input_digest: 'd1',
          verdict: 'REQUEST_CHANGES',
          reserved_cost_usd: 0.5,
          pricing_version: 'mock-2026-08',
          cost_usd: 1.75,
          output_digest: 'o1',
          authoritative: null,
          self_report_mismatches: [],
          handoff: null,
          wait: null,
          next_state: 'CLAUDE_TURN',
        },
      ],
      run.run_id,
      NOW
    )

    const result = checkBudget(run, authorization, SCAFFOLD_LIMITS, ledger, NOW)
    expect(result).toMatchObject({ ok: false, stop_reason: 'cost_cap_reached' })
    expect(result.remaining_usd).toBeCloseTo(0.25)
  })

  it('counts a live reservation against the cap', () => {
    const ledger = computeBudgetLedger(
      [
        {
          schema_version: 'v1',
          run_id: run.run_id,
          at: NOW.toISOString(),
          event: 'turn_started',
          actor: 'gpt_reviewer',
          round: 1,
          idempotency_key: 'k1',
          input_digest: 'd1',
          holder: 'other',
          reserved_cost_usd: 1.8,
          pricing_version: 'mock-2026-08',
          claim_expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
        },
      ],
      run.run_id,
      NOW
    )
    expect(ledger.outstanding_reserved_usd).toBeCloseTo(1.8)
    expect(checkBudget(run, authorization, SCAFFOLD_LIMITS, ledger, NOW)).toMatchObject({
      ok: false,
      stop_reason: 'cost_cap_reached',
    })
  })

  it('keeps an orphaned reservation committed — we cannot know we were not billed', () => {
    const ledger = computeBudgetLedger(
      [
        {
          schema_version: 'v1',
          run_id: run.run_id,
          at: NOW.toISOString(),
          event: 'turn_started',
          actor: 'gpt_reviewer',
          round: 1,
          idempotency_key: 'k1',
          input_digest: 'd1',
          holder: 'crashed-runner',
          reserved_cost_usd: 1.9,
          pricing_version: 'mock-2026-08',
          claim_expires_at: new Date(NOW.getTime() - 1).toISOString(),
        },
      ],
      run.run_id,
      NOW
    )
    expect(ledger.orphaned_reserved_usd).toBeCloseTo(1.9)
    expect(ledger.outstanding_reserved_usd).toBe(0)
    expect(checkBudget(run, authorization, SCAFFOLD_LIMITS, ledger, NOW).ok).toBe(false)
  })

  it('stops at max rounds', () => {
    expect(checkBudget({ ...run, current_round: 6 }, authorization, SCAFFOLD_LIMITS, emptyBudget, NOW)).toMatchObject({
      ok: false,
      stop_reason: 'max_rounds_reached',
    })
  })

  it('stops after the wall-clock deadline', () => {
    const past = new Date(Date.parse(run.deadline_at) + 1)
    expect(checkBudget(run, authorization, SCAFFOLD_LIMITS, emptyBudget, past)).toMatchObject({
      ok: false,
      stop_reason: 'wall_clock_exceeded',
    })
  })
})

describe('authorization window', () => {
  it('accepts a live authorization', () => {
    expect(enforceAuthorizationWindow(authorization, NOW).allowed).toBe(true)
  })

  it('rejects an expired authorization', () => {
    const expired = new Date(Date.parse(authorization.expires_at) + 1)
    expect(enforceAuthorizationWindow(authorization, expired)).toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_EXPIRED',
    })
  })

  it('refuses to parse an authorization that forgets an always-prohibited operation', () => {
    expect(
      workPackageAuthorizationSchema.safeParse({
        ...authorization,
        prohibited_operations: ['merge'],
      }).success
    ).toBe(false)
  })

  it('cannot be constructed with can_merge true', () => {
    expect(
      workPackageAuthorizationSchema.safeParse({
        ...authorization,
        scope: { ...authorization.scope, can_merge: true },
      }).success
    ).toBe(false)
  })
})

describe('the orchestrator cannot be granted to itself', () => {
  it.each([
    'tools/ai-orchestrator/**',
    'tools/**',
    'tools/ai-orchestrator/src/runner.ts',
    '.github/**',
    '.github/workflows/ai-orchestrator-manual.yml',
    '**',
  ])('refuses to parse a scope granting %s', (pattern) => {
    const parsed = workPackageScopeSchema.safeParse({
      ...authorization.scope,
      allowed_paths: [pattern],
    })
    expect(parsed.success).toBe(false)
  })

  it('still accepts an ordinary scope', () => {
    expect(
      workPackageScopeSchema.safeParse({
        ...authorization.scope,
        allowed_paths: ['docs/specs/**', 'src/lib/seo/**'],
      }).success
    ).toBe(true)
  })

  it('is asserted a second time at run time', () => {
    // Hand-built object that bypasses the schema, as a corrupted config would.
    const smuggled = {
      ...authorization,
      scope: { ...authorization.scope, allowed_paths: ['tools/ai-orchestrator/src/**'] },
    }
    expect(enforceAuthorizationWindow(smuggled, NOW)).toMatchObject({
      allowed: false,
      code: 'SELF_MODIFYING_SCOPE',
    })
  })

  it('detects overlap in both directions', () => {
    expect(globsOverlap('tools/**', 'tools/ai-orchestrator/**')).toBe(true)
    expect(globsOverlap('tools/ai-orchestrator/**', 'tools/**')).toBe(true)
    expect(globsOverlap('docs/specs/**', 'tools/ai-orchestrator/**')).toBe(false)
  })

  it('reports which patterns were the problem', () => {
    expect(selectSelfModifyingPatterns(['docs/**', '.github/workflows/**'])).toEqual([
      '.github/workflows/**',
    ])
  })
})

describe('side-effect class', () => {
  it('permits repo_local in the scaffold deployment', () => {
    expect(enforceSideEffectClass(authorization, ['none', 'repo_local']).allowed).toBe(true)
  })

  it('rejects an outward work package', () => {
    expect(
      enforceSideEffectClass({ ...authorization, side_effect_class: 'outward' }, ['none', 'repo_local'])
    ).toMatchObject({ allowed: false, code: 'SIDE_EFFECT_CLASS_NOT_ALLOWED' })
  })
})

describe('path scope', () => {
  it('accepts files inside the allowed globs', () => {
    expect(enforceFileScope(authorization.scope, [IN_SCOPE_FILE]).allowed).toBe(true)
  })

  it('rejects a file that is explicitly denied', () => {
    expect(
      enforceFileScope(authorization.scope, ['src/lib/execution/auto-run-policy.ts'])
    ).toMatchObject({ allowed: false, code: 'PATH_EXPLICITLY_DENIED' })
  })

  it('rejects an unlisted path even when it is not explicitly denied', () => {
    expect(enforceFileScope(authorization.scope, ['website/index.html'])).toMatchObject({
      allowed: false,
      code: 'PATH_OUT_OF_SCOPE',
    })
  })

  it('normalises ./ prefixes so they cannot be used to slip past a deny rule', () => {
    expect(enforceFileScope(authorization.scope, ['./src/lib/a.ts'])).toMatchObject({
      allowed: false,
    })
  })
})

describe('protected paths cover the whole orchestrator', () => {
  it.each([
    '.github/workflows/ai-orchestrator-manual.yml',
    '.github/workflows/factory-sweepers.yml',
    'CODEOWNERS',
    'tools/ai-orchestrator/src/runner.ts',
    'tools/ai-orchestrator/src/domain/schema.ts',
    'tools/ai-orchestrator/src/domain/fold.ts',
    'tools/ai-orchestrator/src/domain/lease.ts',
    'tools/ai-orchestrator/src/domain/digest.ts',
    'tools/ai-orchestrator/src/domain/budget.ts',
    'tools/ai-orchestrator/src/adapters/github/ledger.ts',
    'tools/ai-orchestrator/src/adapters/openai/reviewer.ts',
    'tools/ai-orchestrator/src/adapters/claude/implementer.ts',
    'tools/ai-orchestrator/src/adapters/workspace/git-inspector.ts',
    'tools/ai-orchestrator/src/config/scaffold-config.ts',
    'tools/ai-orchestrator/src/policy/policy.ts',
    'tools/ai-orchestrator/src/prompts/reviewer-system.v1.ts',
    'tools/ai-orchestrator/tests/runner.test.ts',
  ])('refuses a turn touching %s', (path) => {
    expect(enforceProtectedPaths([path])).toMatchObject({
      allowed: false,
      code: 'PROTECTED_PATH_TOUCHED',
    })
  })

  it('leaves ordinary product code alone', () => {
    expect(enforceProtectedPaths(['src/lib/seo/blog.ts', 'docs/specs/x.md']).allowed).toBe(true)
  })

  it('lists every protected glob for the record', () => {
    expect(PROTECTED_PATHS).toEqual(['.github/**', 'CODEOWNERS', 'tools/ai-orchestrator/**'])
  })
})

describe('tool allowlist', () => {
  it('accepts tools on the list', () => {
    expect(enforceToolUse(authorization.scope, ['Read', 'Edit', 'Bash(npm test)']).allowed).toBe(true)
  })

  it('rejects a tool that is simply not listed', () => {
    expect(enforceToolUse(authorization.scope, ['Read', 'Task'])).toMatchObject({
      allowed: false,
      code: 'TOOL_NOT_ALLOWED',
      offending: ['Task'],
    })
  })

  it('rejects an explicitly disallowed tool even when a broader allow rule would match', () => {
    expect(enforceToolUse(authorization.scope, ['Bash(gh pr merge 861)'])).toMatchObject({
      allowed: false,
      code: 'TOOL_NOT_ALLOWED',
    })
  })

  it('rejects a force push', () => {
    expect(enforceToolUse(authorization.scope, ['Bash(git push --force origin main)'])).toMatchObject({
      allowed: false,
    })
  })
})

describe('evaluateImplementerTurn runs on authoritative facts', () => {
  it('accepts a clean turn', () => {
    expect(evaluateImplementerTurn(authorization, facts()).allowed).toBe(true)
  })

  it('reports the protected-path violation ahead of the scope violation', () => {
    expect(
      evaluateImplementerTurn(
        authorization,
        facts({
          files_changed: ['tools/ai-orchestrator/src/runner.ts', 'src/lib/a.ts'],
          cumulative_files_changed: ['tools/ai-orchestrator/src/runner.ts', 'src/lib/a.ts'],
        })
      )
    ).toMatchObject({ code: 'PROTECTED_PATH_TOUCHED' })
  })

  it('rejects a commit that exists when committing is not authorized', () => {
    const readOnly = {
      ...authorization,
      scope: { ...authorization.scope, can_commit: false },
    }
    expect(
      evaluateImplementerTurn(readOnly, facts({ commit: { sha: 'abc123', branch: 'x' } }))
    ).toMatchObject({ allowed: false, code: 'COMMIT_NOT_AUTHORIZED' })
  })

  it('rejects a pull request that exists when that is not authorized', () => {
    const noPr = { ...authorization, scope: { ...authorization.scope, can_open_draft_pr: false } }
    expect(
      evaluateImplementerTurn(
        noPr,
        facts({
          pull_request: { number: 861, head_sha: 'abc', head_ref: 'x', merged: false },
          pull_request_opened_this_turn: true,
        })
      )
    ).toMatchObject({ allowed: false, code: 'PR_NOT_AUTHORIZED' })
  })

  it('rejects a merged pull request outright — merging is never authorized', () => {
    expect(
      evaluateImplementerTurn(
        authorization,
        facts({ pull_request: { number: 861, head_sha: 'abc', head_ref: 'x', merged: true } })
      )
    ).toMatchObject({ allowed: false, code: 'PR_ALREADY_MERGED' })
  })
})

describe('compareSelfReport', () => {
  const output = implementerTurnOutputSchema.parse(implementerOutput())

  it('is silent when the account matches the record', () => {
    expect(compareSelfReport(output, facts())).toEqual([])
  })

  it('names a file the model did not mention', () => {
    const mismatches = compareSelfReport(
      output,
      facts({ files_changed: [IN_SCOPE_FILE, 'src/lib/secret.ts'] })
    )
    expect(mismatches).toContain('files_changed: under-reported "src/lib/secret.ts"')
  })

  it('names a file the model claimed but did not touch', () => {
    expect(compareSelfReport(output, facts({ files_changed: [] }))).toContain(
      `files_changed: claimed "${IN_SCOPE_FILE}" but it is not in the record`
    )
  })

  it('names a tool the model did not mention', () => {
    expect(
      compareSelfReport(output, facts({ tools_used: ['Read', 'Edit', 'Bash(gh pr merge 861)'] }))
    ).toContain('tools_used: under-reported "Bash(gh pr merge 861)"')
  })

  it('catches a fabricated commit', () => {
    const lying = implementerTurnOutputSchema.parse(
      implementerOutput({ commit_evidence: { branch: 'x', commit_sha: 'deadbeef', pr_number: null } })
    )
    expect(compareSelfReport(lying, facts())).toContain(
      'commit: reported deadbeef but this turn produced none'
    )
  })

  it('catches a fabricated pull request', () => {
    const lying = implementerTurnOutputSchema.parse(
      implementerOutput({ commit_evidence: { branch: 'x', commit_sha: 'abc', pr_number: 999 } })
    )
    expect(compareSelfReport(lying, facts({ commit: { sha: 'abc', branch: 'x' } }))).toContain(
      'pull_request: reported 999 but the record says none'
    )
  })
})

describe('glob semantics', () => {
  it('does not let a single star cross a directory boundary', () => {
    expect(matchesGlob('src/lib/a.ts', 'src/*')).toBe(false)
    expect(matchesGlob('src/a.ts', 'src/*')).toBe(true)
    expect(matchesGlob('src/lib/a.ts', 'src/**')).toBe(true)
  })

  it('lets a tool wildcard cross slashes, because tool names are not paths', () => {
    expect(matchesWildcard('Bash(git push origin feat/x)', 'Bash(git push origin*)')).toBe(true)
  })
})
