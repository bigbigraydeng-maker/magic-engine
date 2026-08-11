/**
 * Where single ownership actually comes from.
 *
 * The defect: the Issue-comment lease was treated as the exclusion mechanism.
 * It is not one. Two runners reading an idle ledger at the same instant both
 * compute `acquired: true`, both append `lease_acquired`, and both go on to a
 * paid call. The conflict check afterwards records the duplicate spend; the
 * money is already gone.
 *
 * The fix is not a bigger lock. It is refusing to run without proof that
 * something already serialises this run — GitHub Actions `concurrency`, enforced
 * before either process starts. What these tests pin down is that the refusal is
 * real and reaches every path that could spend money.
 *
 * What they deliberately do NOT claim: that two simultaneous runners were
 * observed and one lost. That exclusion is GitHub's, not ours, and asserting it
 * here would be theatre. Our half is fail-closed, and that is what is tested.
 */

import { describe, expect, it } from 'vitest'

import {
  CONCURRENCY_GROUP_ENV,
  expectedConcurrencyGroup,
  holderFor,
  verifyExclusiveRunContext,
} from '../src/policy/exclusivity'
import { runOrchestration } from '../src/runner'
import { makeHarness, reviewerOutput } from './helpers'

const GOOD_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '1234567',
  [CONCURRENCY_GROUP_ENV]: 'me2-orchestrator-issue-860',
}

describe('verifyExclusiveRunContext', () => {
  it('accepts a real Actions job serialising this exact Issue', () => {
    const result = verifyExclusiveRunContext({ env: GOOD_ENV, issueNumber: 860 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.context).toEqual({
      kind: 'github-actions-concurrency',
      run_id: '1234567',
      concurrency_group: 'me2-orchestrator-issue-860',
    })
    expect(holderFor(result.context)).toBe('gha-run-1234567')
  })

  it('refuses a local invocation, where nothing is serialising anything', () => {
    const result = verifyExclusiveRunContext({ env: {}, issueNumber: 860 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('not running inside GitHub Actions')
  })

  it('refuses an Actions job that does not say what it is serialising on', () => {
    const result = verifyExclusiveRunContext({
      env: { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '1' },
      issueNumber: 860,
    })
    expect(result.ok === false && result.reason).toContain(CONCURRENCY_GROUP_ENV)
  })

  it('refuses a group that serialises a different Issue', () => {
    // The dangerous near-miss: a real concurrency group, just not one that
    // excludes another run working on *this* Issue.
    const result = verifyExclusiveRunContext({
      env: { ...GOOD_ENV, [CONCURRENCY_GROUP_ENV]: 'me2-orchestrator-issue-859' },
      issueNumber: 860,
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('could execute in parallel')
  })

  it('refuses an Actions job with no run id to identify the holder', () => {
    const result = verifyExclusiveRunContext({
      env: { GITHUB_ACTIONS: 'true', [CONCURRENCY_GROUP_ENV]: 'me2-orchestrator-issue-860' },
      issueNumber: 860,
    })
    expect(result.ok === false && result.reason).toContain('GITHUB_RUN_ID')
  })

  it('derives the group from the Issue, so the two cannot drift apart', () => {
    expect(expectedConcurrencyGroup(860)).toBe('me2-orchestrator-issue-860')
    expect(expectedConcurrencyGroup(861)).not.toBe(expectedConcurrencyGroup(860))
  })
})

describe('the runner will not spend without proof of exclusivity', () => {
  it('makes zero provider calls outside GitHub Actions', async () => {
    const h = makeHarness({
      inputOverrides: { env: { ME2_ORCHESTRATOR_ENABLED: 'true' } },
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(0)
    expect(h.implementer.callCount).toBe(0)
    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('no_exclusive_ownership')
    expect(result.stopped_because).toContain('no verified exclusive ownership')
  })

  it('makes zero provider calls when the concurrency group is for another Issue', async () => {
    const h = makeHarness({
      inputOverrides: {
        env: {
          ME2_ORCHESTRATOR_ENABLED: 'true',
          GITHUB_ACTIONS: 'true',
          GITHUB_RUN_ID: '99',
          [CONCURRENCY_GROUP_ENV]: 'me2-orchestrator-issue-859',
        },
      },
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(0)
    expect(result.run.stop_reason).toBe('no_exclusive_ownership')
  })

  it('makes the call when ownership is verified — the positive control', async () => {
    const h = makeHarness({
      reviewerScript: [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.preflight.exclusivity.ok).toBe(true)
    expect(h.reviewer.callCount).toBe(1)
    expect(result.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
  })

  it('refuses before the kill switch even lets a turn be considered', async () => {
    // Ordering check: exclusivity is evaluated before anything that could cost
    // money, not as a late sanity check.
    const h = makeHarness({ inputOverrides: { env: { ME2_ORCHESTRATOR_ENABLED: 'true' } } })
    const result = await runOrchestration(h.input, h.deps)
    expect(result.preflight.budget).toBeNull()
    expect(result.appended.some((event) => event.event === 'turn_started')).toBe(false)
  })

  it('parks on a named wait, so releasing it needs a fresh human approval', async () => {
    const h = makeHarness({ inputOverrides: { env: { ME2_ORCHESTRATOR_ENABLED: 'true' } } })
    const result = await runOrchestration(h.input, h.deps)

    const parked = result.appended.find(
      (event) => event.event === 'state_changed' && event.to === 'WAITING_HUMAN'
    )
    expect(parked && 'wait' in parked && parked.wait?.blocking_reason).toBe('no_exclusive_ownership')
  })
})

describe('dry-run does not take real ownership', () => {
  it('runs its preflight without an exclusive context and writes nothing', async () => {
    // Nothing to race over: no provider call, no ledger write. Requiring the
    // proof here would only make the dry run unusable outside CI.
    const dry = makeHarness({
      dryRun: true,
      inputOverrides: { env: { ME2_ORCHESTRATOR_ENABLED: 'true' } },
    })

    const result = await runOrchestration(dry.input, dry.deps)

    expect(dry.reviewer.callCount).toBe(0)
    expect(dry.github.writeCount).toBe(0)
    expect(result.appended).toHaveLength(0)
    // It still reports what it found, so the gap is visible rather than assumed.
    expect(result.preflight.exclusivity.ok).toBe(false)
  })

  it('reports a verified context in the preflight when there is one', async () => {
    const dry = makeHarness({ dryRun: true })
    const result = await runOrchestration(dry.input, dry.deps)
    expect(result.preflight.exclusivity.ok).toBe(true)
    expect(dry.github.writeCount).toBe(0)
  })
})
