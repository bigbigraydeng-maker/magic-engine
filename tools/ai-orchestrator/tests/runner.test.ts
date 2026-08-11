import { describe, expect, it } from 'vitest'

import { renderEventComment } from '../src/adapters/github/ledger'
import { MockReviewerProvider } from '../src/adapters/openai/mock-reviewer'
import { MockImplementerProvider } from '../src/adapters/claude/mock-implementer'
import { KILL_SWITCH_LABEL } from '../src/policy/policy'
import type { LedgerEvent, RunState } from '../src/domain/schema'
import { runOrchestration } from '../src/runner'
import type { RunnerResult } from '../src/runner'
import { SCAFFOLD_LIMITS } from '../src/config/scaffold-config'
import type { OrchestratorLimits } from '../src/policy/policy'
import {
  FIXED_NOW,
  IN_SCOPE_FILE,
  defaultCaptures,
  fingerprints,
  implementerOutput,
  makeHarness,
  quietCaptures,
  reviewerOutput,
  workspaceState,
} from './helpers'

function limitsWith(overrides: Partial<OrchestratorLimits>): OrchestratorLimits {
  return { ...SCAFFOLD_LIMITS, ...overrides }
}

/**
 * Turn-driven transitions ride on the turn event itself, so the state trail has
 * to be read from both kinds of event.
 */
function statesReached(result: RunnerResult): RunState[] {
  return result.appended.flatMap((event) => {
    if (event.event === 'state_changed') return [event.to]
    if (event.event === 'turn_completed' || event.event === 'turn_rejected') return [event.next_state]
    return []
  })
}

describe('happy path', () => {
  it('runs one reviewer turn and stops at APPROVED_FOR_HUMAN_MERGE without merging anything', async () => {
    const h = makeHarness({
      reviewerScript: [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
    expect(result.run.stop_reason).toBe('reviewer_approved')
    expect(h.reviewer.callCount).toBe(1)
    expect(h.implementer.callCount).toBe(0)
    expect(statesReached(result)).toEqual(['GPT_TURN', 'APPROVED_FOR_HUMAN_MERGE'])
  })

  it('alternates reviewer and implementer in DESIGN mode', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) },
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'Upgrade the GitHub plan?' }) },
      ],
      implementerScript: [{ output: implementerOutput() }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(2)
    expect(h.implementer.callCount).toBe(1)
    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(statesReached(result)).toEqual(['GPT_TURN', 'CLAUDE_TURN', 'GPT_TURN', 'WAITING_HUMAN'])
  })

  it('carries prompt-version identity into every provider request', async () => {
    const h = makeHarness()
    await runOrchestration(h.input, h.deps)
    expect(h.reviewer.requests[0].system).toContain('Architecture & Product Reviewer')
    expect(h.reviewer.requests[0].user).toContain('reviewer-system.v1')
  })
})

describe('kill switch', () => {
  it('cancels before calling any provider when the stop label is on the Issue', async () => {
    const h = makeHarness({ labels: [KILL_SWITCH_LABEL] })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('CANCELLED')
    expect(result.run.stop_reason).toBe('kill_switch')
    expect(h.reviewer.callCount).toBe(0)
    expect(h.implementer.callCount).toBe(0)
  })

  it('cancels when the enable env var is absent', async () => {
    const h = makeHarness({ inputOverrides: { env: {} } })
    const result = await runOrchestration(h.input, h.deps)
    expect(result.run.state).toBe('CANCELLED')
    expect(h.reviewer.callCount).toBe(0)
  })

  it('cancels when the workflow input says disabled', async () => {
    const h = makeHarness({ inputOverrides: { workflowEnabledInput: false } })
    const result = await runOrchestration(h.input, h.deps)
    expect(result.run.state).toBe('CANCELLED')
    expect(h.reviewer.callCount).toBe(0)
  })
})

describe('budget stops', () => {
  it('stops at max rounds instead of looping forever', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN', max_rounds: 3 },
      inputOverrides: { limits: limitsWith({ max_rounds: 3, cost_cap_usd: 100, max_invalid_outputs: 5 }) },
      reviewerScript: [{ output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) }],
      implementerScript: [{ output: implementerOutput() }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('BUDGET_EXHAUSTED')
    expect(result.run.stop_reason).toBe('max_rounds_reached')
    expect(result.run.current_round).toBe(3)
    expect(h.reviewer.callCount + h.implementer.callCount).toBe(3)
  })

  it('stops at the cost cap even when rounds remain', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN', cost_cap_usd: 0.3 },
      inputOverrides: { limits: limitsWith({ max_rounds: 20, cost_cap_usd: 0.9, max_invalid_outputs: 5 }) },
      reviewerScript: [{ output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }), usage: { cost_usd: 0.05 } }],
      implementerScript: [{ output: implementerOutput(), usage: { cost_usd: 0.2 } }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('BUDGET_EXHAUSTED')
    expect(result.run.stop_reason).toBe('cost_cap_reached')
    expect(result.run.current_round).toBeLessThan(20)

    // The property that matters: it stopped *below* the cap, with too little left
    // to cover another reservation. A cap crossed and then noticed is not a cap.
    const cap = 0.3
    expect(result.run.cumulative_cost_usd).toBeLessThanOrEqual(cap)
  })

  it('stops when the wall-clock deadline has passed', async () => {
    const h = makeHarness({
      runOverrides: { deadline_at: new Date(FIXED_NOW.getTime() - 1).toISOString() },
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('BUDGET_EXHAUSTED')
    expect(result.run.stop_reason).toBe('wall_clock_exceeded')
    expect(h.reviewer.callCount).toBe(0)
  })
})

describe('schema-invalid provider output', () => {
  it('does not advance the run on one bad reviewer response', async () => {
    const h = makeHarness({
      reviewerScript: [
        { output: { verdict: 'LOOKS_GOOD_TO_ME', summary: 'ship it' } },
        { output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) },
      ],
      // Two reviewer turns and no implementer: the workspace never moves, which is
      // also what the reviewer read-only check requires of it.
      workspace: quietCaptures(),
    })

    const result = await runOrchestration(h.input, h.deps)

    const rejected = result.appended.filter((e) => e.event === 'turn_rejected')
    expect(rejected).toHaveLength(1)
    // The bad turn left the run exactly where it was; only the good one moved it.
    expect(rejected[0]).toMatchObject({ reason: 'invalid_output', next_state: 'GPT_TURN' })
    expect(statesReached(result)).toEqual(['GPT_TURN', 'GPT_TURN', 'APPROVED_FOR_HUMAN_MERGE'])
    expect(result.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
  })

  it('fails the run rather than retrying forever', async () => {
    const h = makeHarness({
      reviewerScript: [{ output: { nonsense: true } }],
      inputOverrides: {
        limits: limitsWith({ max_rounds: 10, cost_cap_usd: 100, max_invalid_outputs: 2 }),
      },
      authorizationOverrides: { max_rounds: 10, cost_cap_usd: 100 },
      workspace: quietCaptures(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('FAILED')
    expect(result.run.stop_reason).toBe('invalid_provider_output')
    expect(h.reviewer.callCount).toBe(2)
  })

  it('still charges a rejected turn, because the provider billed us for it', async () => {
    const h = makeHarness({
      reviewerScript: [
        { output: { bad: true }, usage: { cost_usd: 0.04 } },
        { output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }), usage: { cost_usd: 0.01 } },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.cumulative_cost_usd).toBeCloseTo(0.05)
  })
})

describe('policy violations park the run for a human', () => {
  it('refuses an implementer turn that used a tool outside the allowlist', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({ tools_used: ['Read', 'Bash(gh pr merge 861 --admin)'] }),
          telemetry: { tools_used: ['Read', 'Bash(gh pr merge 861 --admin)'] },
        },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('policy_violation')
    const rejected = result.appended.find((e) => e.event === 'turn_rejected')
    expect(rejected).toMatchObject({ reason: 'policy_violation' })
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('TOOL_NOT_ALLOWED')
  })

  it('refuses an implementer turn that edited a file outside its scope', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        { output: implementerOutput({ files_changed: ['src/lib/execution/auto-run-policy.ts'] }) },
      ],
      workspace: [
        workspaceState({ file_fingerprints: {} }),
        workspaceState({ file_fingerprints: fingerprints(['src/lib/execution/auto-run-policy.ts']) }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = result.appended.find((e) => e.event === 'turn_rejected')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PATH_EXPLICITLY_DENIED')
  })

  it('refuses an implementer turn that rewrote the workflow governing it', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            files_changed: [
              'tools/ai-orchestrator/src/runner.ts',
              '.github/workflows/ai-orchestrator-manual.yml',
            ],
          }),
        },
      ],
      workspace: [
        workspaceState({ file_fingerprints: {} }),
        workspaceState({
          file_fingerprints: fingerprints([
            'tools/ai-orchestrator/src/runner.ts',
            '.github/workflows/ai-orchestrator-manual.yml',
          ]),
        }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = result.appended.find((e) => e.event === 'turn_rejected')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PROTECTED_PATH_TOUCHED')
  })

  it('refuses an implementer turn that rewrote the policy file it did not declare', async () => {
    // files_changed looks clean, but the on-disk snapshot moved — the case a
    // self-reported file list can never catch on its own.
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      drift: ['tools/ai-orchestrator/src/policy/policy.ts'],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = result.appended.find((e) => e.event === 'turn_rejected')
    expect(rejected).toMatchObject({ reason: 'policy_integrity_drift' })
  })

  it('accepts the same turn when the control plane did not move — the positive control', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      drift: [],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.appended.some((e) => e.event === 'turn_rejected')).toBe(false)
    expect(h.implementer.callCount).toBe(1)
  })
})

describe('expired authorization', () => {
  it('parks the run instead of running on a stale grant', async () => {
    const h = makeHarness({
      inputOverrides: {},
    })
    const expired = {
      ...h.input,
      authorization: {
        ...h.authorization,
        expires_at: new Date(FIXED_NOW.getTime() - 1).toISOString(),
      },
    }

    const result = await runOrchestration(expired, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('authorization_expired')
    expect(h.reviewer.callCount).toBe(0)
  })

  it('refuses an outward work package outright', async () => {
    const h = makeHarness()
    const outward = {
      ...h.input,
      authorization: { ...h.authorization, side_effect_class: 'outward' as const },
    }

    const result = await runOrchestration(outward, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(h.reviewer.callCount).toBe(0)
  })
})

describe('concurrency', () => {
  it('refuses to take a turn while another runner holds the lease', async () => {
    const h = makeHarness()
    const leaseEvent: LedgerEvent = {
      schema_version: 'v1',
      run_id: 'run-other',
      at: FIXED_NOW.toISOString(),
      event: 'lease_acquired',
      lock_key: 'bigbigraydeng-maker/magic-engine#860',
      holder: 'gha-run-first',
      lease_id: 'lease-1',
      expires_at: new Date(FIXED_NOW.getTime() + 600_000).toISOString(),
      took_over_from: null,
    }
    h.github.seedComment({
      author_login: 'me2-orchestrator-bot',
      body: renderEventComment(leaseEvent),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.stopped_because).toContain('lease held by gha-run-first')
    expect(h.reviewer.callCount).toBe(0)
    expect(h.github.writeCount).toBe(0)
  })
})

describe('duplicate delivery', () => {
  it('does not re-run a parked run when the workflow is dispatched again', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'plan ok?' }) }],
    })

    const first = await runOrchestration(h.input, h.deps)
    expect(first.run.state).toBe('WAITING_HUMAN')
    const writesAfterFirst = h.github.writeCount
    expect(writesAfterFirst).toBeGreaterThan(0)

    // Second dispatch: same Issue, same ledger, fresh provider mocks.
    const reviewer = new MockReviewerProvider([{ output: reviewerOutput() }])
    const implementer = new MockImplementerProvider([{ output: implementerOutput() }])
    const second = await runOrchestration(h.input, { ...h.deps, reviewer, implementer })

    expect(reviewer.callCount).toBe(0)
    expect(implementer.callCount).toBe(0)
    expect(h.github.writeCount).toBe(writesAfterFirst)
    expect(second.run.state).toBe('WAITING_HUMAN')
    expect(second.stopped_because).toContain('waiting for human')
  })

  it('does not re-pay for a turn whose runner died right after recording it', async () => {
    // A turn event carries where the run landed, so there is no window in which
    // "the turn happened" is durable but "the run moved on" is not.
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      implementerScript: [{ output: implementerOutput() }],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      // Round 1 happened in the process that died, so it consumed no captures
      // here: this process opens on the implementer's pair, not the reviewer's.
      workspace: defaultCaptures(),
    })

    const crashedTurn: LedgerEvent = {
      schema_version: 'v1',
      run_id: h.run.run_id,
      at: FIXED_NOW.toISOString(),
      event: 'turn_completed',
      actor: 'gpt_reviewer',
      round: 1,
      idempotency_key: 'key-from-the-crashed-run',
      input_digest: 'digest-from-the-crashed-run',
      verdict: 'REQUEST_CHANGES',
      reserved_cost_usd: 0.5,
      pricing_version: 'mock-2026-08',
      cost_usd: 0.05,
      output_digest: 'abc',
      authoritative: null,
      self_report_mismatches: [],
      handoff: null,
      wait: null,
      next_state: 'CLAUDE_TURN',
    }
    h.github.seedComment({
      author_login: 'me2-orchestrator-bot',
      body: renderEventComment(crashedTurn),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    // Round 1 is not repeated: the implementer picks up at round 2.
    expect(h.implementer.callCount).toBe(1)
    expect(h.implementer.requests[0].round).toBe(2)
    // The reviewer only runs its *next* turn, never round 1 again.
    expect(h.reviewer.callCount).toBe(1)
    expect(h.reviewer.requests[0].round).toBe(3)
    expect(result.run.cumulative_cost_usd).toBeCloseTo(0.05 + 0.2 + 0.05)
  })

  it('discards its own result when another runner recorded the same turn mid-call', async () => {
    // Learn the key the next turn will use, so the "other runner" can claim it.
    const probe = makeHarness({ dryRun: true })
    const preflight = (await runOrchestration(probe.input, probe.deps)).preflight
    const key = preflight.next_idempotency_key as string
    expect(key).toBeTruthy()

    const h = makeHarness()
    const rival: LedgerEvent = {
      schema_version: 'v1',
      run_id: h.run.run_id,
      at: FIXED_NOW.toISOString(),
      event: 'turn_completed',
      actor: 'gpt_reviewer',
      round: 1,
      idempotency_key: key,
      input_digest: preflight.next_input_digest as string,
      verdict: 'REQUEST_CHANGES',
      reserved_cost_usd: 0.5,
      pricing_version: 'mock-2026-08',
      cost_usd: 0.05,
      output_digest: 'from-the-other-runner',
      authoritative: null,
      self_report_mismatches: [],
      handoff: null,
      wait: null,
      next_state: 'CLAUDE_TURN',
    }

    // The rival's comment lands after our first read — i.e. while we were waiting
    // on the model — which is exactly when the lease cannot help us.
    let reads = 0
    const racing = {
      ...h.deps,
      github: {
        name: 'racing',
        listIssueLabels: () => h.github.listIssueLabels(),
        createIssueComment: (issue: number, body: string) => h.github.createIssueComment(issue, body),
        listPullRequestFiles: (pr: number) => h.github.listPullRequestFiles(pr),
        getPullRequest: (pr: number) => h.github.getPullRequest(pr),
        listIssueComments: async () => {
          reads += 1
          if (reads === 2) {
            h.github.seedComment({
              author_login: 'me2-orchestrator-bot',
              body: renderEventComment(rival),
              created_at: FIXED_NOW.toISOString(),
            })
          }
          return h.github.listIssueComments()
        },
      },
    }

    const result = await runOrchestration(h.input, racing)

    expect(h.reviewer.callCount).toBe(1) // we did call, then found we had lost

    expect(result.stopped_because).toContain('recorded by another runner')
    // Our result is discarded — no turn record of ours, no state change of ours.
    expect(result.appended.some((e) => e.event === 'turn_completed')).toBe(false)
    expect(result.appended.some((e) => e.event === 'state_changed')).toBe(true) // only READY -> GPT_TURN

    // But the money we spent losing the race is on the record, not swallowed.
    const duplicate = result.appended.find((e) => e.event === 'duplicate_spend_recorded')
    expect(duplicate).toMatchObject({ holder: 'test-holder', cost_usd: 0.05 })
    // Rival's settled turn ($0.05) plus our discarded call ($0.05).
    expect(result.run.cumulative_cost_usd).toBeCloseTo(0.1)
  })
})

describe('WAITING_HUMAN', () => {
  it('stays parked when nobody has authorised anything', async () => {
    const h = makeHarness({ runOverrides: { state: 'WAITING_HUMAN', current_round: 2 } })

    const parked = await runOrchestration(h.input, h.deps)

    expect(parked.run.state).toBe('WAITING_HUMAN')
    expect(h.reviewer.callCount).toBe(0)
    expect(h.github.writeCount).toBe(0)
  })
})

describe('terminal runs', () => {
  it.each(['APPROVED_FOR_HUMAN_MERGE', 'FAILED', 'BUDGET_EXHAUSTED', 'CANCELLED'] as RunState[])(
    'refuses to restart a %s run',
    async (state) => {
      const h = makeHarness({ runOverrides: { state } })
      const result = await runOrchestration(h.input, h.deps)
      expect(result.stopped_because).toContain('already terminal')
      expect(h.reviewer.callCount).toBe(0)
      expect(h.github.writeCount).toBe(0)
    }
  )
})
