/**
 * The gates that have to hold for the whole loop, not just its first turn.
 *
 * Two defects found in review, both of the same shape — a protection that was
 * correct once per dispatch while the thing it protects against happens per turn:
 *
 * 1. **The kill switch and the authorization window were read once**, before
 *    `executeLoop`, and the loop then ran up to `max_rounds` paid turns without
 *    looking again. Someone adding `me2-orchestrator:stop` during round 1 would
 *    have watched rounds 2..6 run anyway, and an authorization that expired after
 *    round 1 stopped meaning anything. A kill switch nobody can pull mid-run is
 *    not a kill switch.
 *
 * 2. **The lease was released unconditionally at the end.** When a provider that
 *    declares `cancellation.supported = false` blew its timeout, the old call was
 *    still running — possibly still writing to the repository, definitely still
 *    billable — and we ended the Actions concurrency group anyway. A human who
 *    authorised a resume could then start a second call beside the first, which
 *    is exactly what sizing the claim to `server_max_timeout_ms` was supposed to
 *    prevent. Both real adapters declare `false`, so this is the normal path.
 */

import { describe, expect, it } from 'vitest'

import { InMemoryGitHubClient } from '../src/adapters/github/memory-client'
import type { GitHubClient } from '../src/adapters/github/client'
import { currentLease, evaluateLeaseAcquisition } from '../src/domain/lease'
import type { LedgerEvent } from '../src/domain/schema'
import { MockReviewerProvider } from '../src/adapters/openai/mock-reviewer'
import type { ReviewerProvider } from '../src/adapters/provider-types'
import { KILL_SWITCH_LABEL } from '../src/policy/policy'
import { runOrchestration } from '../src/runner'
import {
  FIXED_NOW,
  makeHarness,
  quietCaptures,
  quietImplementerOutput,
  reviewerOutput,
} from './helpers'

const LOCK_KEY = 'bigbigraydeng-maker/magic-engine#860'

/**
 * A GitHub client whose label list changes after N reads.
 *
 * Modelling the label as mutable is the point: a fixed list can only ever prove
 * the preflight check works, which it already did.
 */
class LabelChangingClient implements GitHubClient {
  readonly name = 'label-changing'
  labelReads = 0

  constructor(
    private readonly inner: InMemoryGitHubClient,
    private readonly options: { addAfterReads: number; label: string }
  ) {}

  async listIssueLabels(_issueNumber: number): Promise<readonly string[]> {
    this.labelReads += 1
    const base = await this.inner.listIssueLabels()
    return this.labelReads > this.options.addAfterReads ? [...base, this.options.label] : base
  }

  listIssueComments() {
    return this.inner.listIssueComments()
  }

  createIssueComment(issueNumber: number, body: string) {
    return this.inner.createIssueComment(issueNumber, body)
  }

  listPullRequestFiles(prNumber: number) {
    return this.inner.listPullRequestFiles(prNumber)
  }

  getPullRequest(prNumber: number) {
    return this.inner.getPullRequest(prNumber)
  }
}

describe('the kill switch is re-read before every paid call', () => {
  it('stops the loop when the stop label appears after round 1', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [{ output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) }],
      implementerScript: [{ output: quietImplementerOutput() }],
      workspace: quietCaptures(),
    })
    const github = new LabelChangingClient(h.github, {
      addAfterReads: 2, // preflight + round 1; the label is there by round 2
      label: KILL_SWITCH_LABEL,
    })

    const result = await runOrchestration(h.input, { ...h.deps, github })

    expect(h.reviewer.callCount).toBe(1)
    // The turn that would have been round 2 never happened.
    expect(h.implementer.callCount).toBe(0)
    expect(result.run.state).toBe('CANCELLED')
    expect(result.run.stop_reason).toBe('kill_switch')
  })

  it('reads the labels once per turn, not once per dispatch', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) },
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'done?' }) },
      ],
      implementerScript: [{ output: quietImplementerOutput() }],
      workspace: quietCaptures(),
    })
    const github = new LabelChangingClient(h.github, { addAfterReads: 99, label: 'never' })

    await runOrchestration(h.input, { ...h.deps, github })

    expect(h.reviewer.callCount + h.implementer.callCount).toBe(3)
    // 1 preflight + 3 turns. Reading once per dispatch would leave this at 1.
    expect(github.labelReads).toBe(4)
  })

  it('refuses to spend when the label list cannot be read at all', async () => {
    // "We could not look" is not "there is no stop label".
    const h = makeHarness({ workspace: quietCaptures() })
    let reads = 0
    const github: GitHubClient = {
      name: 'flaky',
      listIssueLabels: async (_issue: number) => {
        reads += 1
        if (reads > 1) throw new Error('502 from GitHub')
        return h.github.listIssueLabels()
      },
      listIssueComments: () => h.github.listIssueComments(),
      createIssueComment: (issue: number, body: string) => h.github.createIssueComment(issue, body),
      listPullRequestFiles: (pr: number) => h.github.listPullRequestFiles(pr),
      getPullRequest: (pr: number) => h.github.getPullRequest(pr),
    }

    const result = await runOrchestration(h.input, { ...h.deps, github })

    expect(h.reviewer.callCount).toBe(0)
    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.stopped_because).toContain('kill switch cannot be ruled out')
  })
})

describe('the authorization window is re-checked before every paid call', () => {
  /**
   * A harness whose clock jumps past the grant's expiry the moment round 1's
   * reviewer call returns.
   *
   * Tying the jump to the call rather than to a count of clock reads is what makes
   * this deterministic: "expired between rounds" is a fact about the sequence, not
   * about how many times the runner happens to look at the clock.
   */
  function harnessExpiringAfterRoundOne(expireIt: boolean) {
    const expiresAt = new Date(FIXED_NOW.getTime() + 60_000)
    let now = FIXED_NOW

    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) },
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'done?' }) },
      ],
      implementerScript: [{ output: quietImplementerOutput() }],
      authorizationOverrides: { expires_at: expiresAt.toISOString() },
      workspace: quietCaptures(),
    })

    const inner = h.reviewer
    const reviewer: ReviewerProvider = {
      name: inner.name,
      cancellation: inner.cancellation,
      maxCostFor: (query) => inner.maxCostFor(query),
      review: async (request) => {
        const result = await inner.review(request)
        if (expireIt) now = new Date(expiresAt.getTime() + 1)
        return result
      },
    }

    return { ...h, deps: { ...h.deps, reviewer, clock: { now: () => now } } }
  }

  it('stops the loop when the grant expires between rounds', async () => {
    const h = harnessExpiringAfterRoundOne(true)

    const result = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(1)
    // The paid turn that would have been round 2 never happened.
    expect(h.implementer.callCount).toBe(0)
    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('authorization_expired')
  })

  it('runs every round when the grant stays live — the positive control', async () => {
    const h = harnessExpiringAfterRoundOne(false)

    await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(2)
    expect(h.implementer.callCount).toBe(1)
  })
})

describe('a call that cannot be cancelled keeps the lease', () => {
  function uncancellableTimeout() {
    return makeHarness({
      inputOverrides: {
        limits: { ...makeHarness().input.limits, provider_timeout_ms: 20 },
        leaseTtlMs: 40 * 60_000,
      },
      workspace: quietCaptures(),
      depsOverrides: {
        reviewer: new MockReviewerProvider([{ output: reviewerOutput(), delayMs: 200 }], {
          cancellation: { supported: false, server_max_timeout_ms: 30 * 60_000 },
        }),
      },
    })
  }

  it('writes lease_retained instead of lease_released', async () => {
    const h = uncancellableTimeout()

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.stop_reason).toBe('provider_timeout')
    expect(result.appended.some((event) => event.event === 'lease_released')).toBe(false)
    const retained = result.appended.find((event) => event.event === 'lease_retained')
    expect(retained).toBeTruthy()
    expect(retained && 'reason' in retained && retained.reason).toContain(
      'cancellation.supported=false'
    )
  })

  it('holds the lease for the provider server-side maximum, not our timeout', async () => {
    const h = uncancellableTimeout()

    const result = await runOrchestration(h.input, h.deps)

    const retained = result.appended.find((event) => event.event === 'lease_retained')
    const until =
      retained && 'retained_until' in retained ? Date.parse(retained.retained_until) : 0
    // 30 minutes out, not the 20ms local timeout.
    expect(until - FIXED_NOW.getTime()).toBe(30 * 60_000)
  })

  it('turns a second runner away for the whole retained window', async () => {
    const h = uncancellableTimeout()
    await runOrchestration(h.input, h.deps)

    // Replay the ledger the way a fresh dispatch would.
    const events = decodeLedger(await h.github.listIssueComments())
    const justAfterOurOwnTtl = new Date(FIXED_NOW.getTime() + 15 * 60_000)

    const rival = evaluateLeaseAcquisition({
      events,
      lockKey: LOCK_KEY,
      holder: 'gha-run-second',
      now: justAfterOurOwnTtl,
      ttlMs: 40 * 60_000,
      leaseId: 'lease-rival',
    })

    expect(rival.acquired).toBe(false)
    expect(rival.acquired === false && rival.held_by).toBe('test-holder')
  })

  it('releases normally when the provider does prove it cancels — the positive control', async () => {
    // Same timeout, same failure, but the adapter can actually stop the work, so
    // there is nothing left running to protect against.
    const h = makeHarness({
      inputOverrides: {
        limits: { ...makeHarness().input.limits, provider_timeout_ms: 20 },
      },
      workspace: quietCaptures(),
      depsOverrides: {
        reviewer: new MockReviewerProvider([{ output: reviewerOutput(), delayMs: 200 }], {
          cancellation: { supported: true, server_max_timeout_ms: 10 * 60_000 },
        }),
      },
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.stop_reason).toBe('provider_timeout')
    expect(result.appended.some((event) => event.event === 'lease_retained')).toBe(false)
    expect(result.appended.some((event) => event.event === 'lease_released')).toBe(true)
  })

  it('and that release is exactly what let the rival in — the contrast', async () => {
    // The same timeout with a cancellable adapter frees the lock immediately, so
    // the next runner starts at once. That is correct there and was the bug here:
    // the only difference is whether anything can still be running.
    const h = makeHarness({
      inputOverrides: { limits: { ...makeHarness().input.limits, provider_timeout_ms: 20 } },
      workspace: quietCaptures(),
      depsOverrides: {
        reviewer: new MockReviewerProvider([{ output: reviewerOutput(), delayMs: 200 }], {
          cancellation: { supported: true, server_max_timeout_ms: 10 * 60_000 },
        }),
      },
    })
    await runOrchestration(h.input, h.deps)

    const events = decodeLedger(await h.github.listIssueComments())
    expect(
      evaluateLeaseAcquisition({
        events,
        lockKey: LOCK_KEY,
        holder: 'gha-run-second',
        now: new Date(FIXED_NOW.getTime() + 60_000),
        ttlMs: 40 * 60_000,
        leaseId: 'lease-rival',
      }).acquired
    ).toBe(true)
  })

  it('releases normally on a clean finish — the other positive control', async () => {
    const h = makeHarness({ workspace: quietCaptures() })
    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
    expect(result.appended.some((event) => event.event === 'lease_retained')).toBe(false)
    expect(result.appended.some((event) => event.event === 'lease_released')).toBe(true)
  })
})

describe('lease retention obeys the same fencing rule as release', () => {
  const acquired: LedgerEvent = {
    schema_version: 'v1',
    run_id: 'r1',
    at: FIXED_NOW.toISOString(),
    event: 'lease_acquired',
    lock_key: LOCK_KEY,
    holder: 'holder-a',
    lease_id: 'lease-1',
    expires_at: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
    took_over_from: null,
  }

  function retained(overrides: Partial<Extract<LedgerEvent, { event: 'lease_retained' }>>): LedgerEvent {
    return {
      schema_version: 'v1',
      run_id: 'r1',
      at: FIXED_NOW.toISOString(),
      event: 'lease_retained',
      lock_key: LOCK_KEY,
      holder: 'holder-a',
      lease_id: 'lease-1',
      retained_until: new Date(FIXED_NOW.getTime() + 600_000).toISOString(),
      reason: 'uncancellable call may still be running',
      ...overrides,
    }
  }

  const at = new Date(FIXED_NOW.getTime() + 120_000)

  it('extends the live lease', () => {
    const lease = currentLease([acquired, retained({})], LOCK_KEY, at)
    expect(lease?.stale).toBe(false)
    expect(lease?.expires_at).toBe(new Date(FIXED_NOW.getTime() + 600_000).toISOString())
  })

  it('ignores a retention from a different holder', () => {
    const lease = currentLease([acquired, retained({ holder: 'holder-b' })], LOCK_KEY, at)
    expect(lease?.stale).toBe(true)
  })

  it('ignores a retention naming a superseded fencing token', () => {
    const lease = currentLease([acquired, retained({ lease_id: 'lease-0' })], LOCK_KEY, at)
    expect(lease?.stale).toBe(true)
  })

  it('never shortens a lease', () => {
    const lease = currentLease(
      [acquired, retained({ retained_until: new Date(FIXED_NOW.getTime() + 1).toISOString() })],
      LOCK_KEY,
      new Date(FIXED_NOW.getTime() + 30_000)
    )
    expect(lease?.expires_at).toBe(acquired.event === 'lease_acquired' ? acquired.expires_at : '')
    expect(lease?.stale).toBe(false)
  })

  it('does not resurrect a lease that was already released', () => {
    const released: LedgerEvent = {
      schema_version: 'v1',
      run_id: 'r1',
      at: FIXED_NOW.toISOString(),
      event: 'lease_released',
      lock_key: LOCK_KEY,
      holder: 'holder-a',
      lease_id: 'lease-1',
    }
    expect(currentLease([acquired, released, retained({})], LOCK_KEY, at)).toBeNull()
  })
})

/** Reads the ledger back the way a fresh dispatch would. */
function decodeLedger(page: { comments: readonly { body: string }[] }): LedgerEvent[] {
  return page.comments.flatMap((comment) => {
    const match = /<!-- me2-orchestrator:v1 (\{[\s\S]*?\}) -->/.exec(comment.body)
    return match ? [JSON.parse(match[1]) as LedgerEvent] : []
  })
}
