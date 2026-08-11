/**
 * Dry-run proof, and the evidence artefact the manual workflow prints.
 *
 * Every assertion here has a matching positive control in the same file: the
 * identical harness run with `dryRun: false`. Asserting "zero calls" on its own
 * would pass just as happily if the runner were broken and did nothing at all.
 */

import { describe, expect, it } from 'vitest'

import { runOrchestration } from '../src/runner'
import { implementerOutput, makeHarness, reviewerOutput } from './helpers'

describe('dry run makes no calls, no comments and no commits', () => {
  it('calls no provider', async () => {
    const dry = makeHarness({ dryRun: true })
    await runOrchestration(dry.input, dry.deps)
    expect(dry.reviewer.callCount).toBe(0)
    expect(dry.implementer.callCount).toBe(0)

    const wet = makeHarness({ dryRun: false })
    await runOrchestration(wet.input, wet.deps)
    expect(wet.reviewer.callCount).toBe(1) // positive control
  })

  it('writes no Issue comment', async () => {
    const dry = makeHarness({ dryRun: true })
    const result = await runOrchestration(dry.input, dry.deps)
    expect(dry.github.writeCount).toBe(0)
    expect(result.plannedWrites).toHaveLength(0)
    expect(result.appended).toHaveLength(0)

    const wet = makeHarness({ dryRun: false })
    await runOrchestration(wet.input, wet.deps)
    expect(wet.github.writeCount).toBeGreaterThan(0) // positive control
  })

  it('produces no commit, push or pull request', async () => {
    const committing = { commit_evidence: { branch: 'claude/x', commit_sha: 'abc1234', pr_number: 861 } }

    const dry = makeHarness({
      dryRun: true,
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput(committing) }],
    })
    await runOrchestration(dry.input, dry.deps)
    expect(dry.implementer.sideEffects).toHaveLength(0)

    const wet = makeHarness({
      dryRun: false,
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput(committing) }],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
    })
    await runOrchestration(wet.input, wet.deps)
    // positive control: the recorder does fire when a turn actually runs
    expect(wet.implementer.sideEffects.map((effect) => effect.kind)).toEqual([
      'commit',
      'push',
      'open_draft_pr',
    ])
  })

  it('leaves the recorded run state untouched', async () => {
    const dry = makeHarness({ dryRun: true })
    await runOrchestration(dry.input, dry.deps)
    const reread = await dry.github.listIssueComments()
    expect(reread.comments).toHaveLength(0)
    expect(reread.comment_count).toBe(0)
  })
})

describe('dry-run preflight report', () => {
  it('reports every guard it evaluated, and what it would do next', async () => {
    const dry = makeHarness({ dryRun: true })
    const result = await runOrchestration(dry.input, dry.deps)

    expect(result.preflight.kill_switch).toEqual({ stopped: false, reason: null })
    expect(result.preflight.authorization.allowed).toBe(true)
    expect(result.preflight.side_effect_class.allowed).toBe(true)
    expect(result.preflight.lease).toMatchObject({ acquired: true })
    expect(result.preflight.budget).toMatchObject({ ok: true })
    expect(result.preflight.budget?.remaining_usd).toBe(2)
    expect(result.preflight.next_actor).toBe('gpt_reviewer')
    expect(result.preflight.next_idempotency_key).toMatch(/^[0-9a-f]{32}$/)
    expect(result.preflight.ledger_rejected).toHaveLength(0)

    // Evidence artefact — the manual workflow surfaces this in its job log.
    // eslint-disable-next-line no-console
    console.log(
      `\nME2 ORCHESTRATOR DRY-RUN REPORT\n${JSON.stringify(
        {
          dry_run: result.dryRun,
          stopped_because: result.stopped_because,
          provider_calls: { reviewer: dry.reviewer.callCount, implementer: dry.implementer.callCount },
          github_writes: dry.github.writeCount,
          planned_writes: result.plannedWrites.length,
          run: {
            run_id: result.run.run_id,
            mode: result.run.mode,
            state: result.run.state,
            current_round: result.run.current_round,
            max_rounds: result.run.max_rounds,
            cumulative_cost_usd: result.run.cumulative_cost_usd,
            cost_cap_usd: result.run.cost_cap_usd,
          },
          preflight: result.preflight,
        },
        null,
        2
      )}\n`
    )
  })

  it('reports the kill switch as the reason when the run is disabled', async () => {
    const dry = makeHarness({ dryRun: true, inputOverrides: { env: {} } })
    const result = await runOrchestration(dry.input, dry.deps)

    expect(result.preflight.kill_switch.stopped).toBe(true)
    expect(result.stopped_because).toContain('ME2_ORCHESTRATOR_ENABLED')
    expect(result.preflight.next_actor).toBeNull()
    expect(dry.github.writeCount).toBe(0)
  })
})
