/**
 * The human gate, end to end, against the **actual scaffold config**.
 *
 * Two defects live here, both found in review, both of the same shape: an
 * approval that meant more than the person giving it intended.
 *
 * 1. `TRUSTED_LEDGER_AUTHORS` held only the bot, so the owner's own
 *    authorization was discarded at decode time and a parked run could never be
 *    released — the gate was shut in both directions.
 * 2. `resumeFromWaitingHuman` took the run's most recent authorization without
 *    checking *which block* it was for. One approval in round 2 therefore
 *    released a different, unreviewed block in round 5. Approving one risk gate
 *    is not approving every future one.
 *
 * So an authorization now names a `wait_id`, must be written after that wait
 * opened, and must grant the specific reason that blocked the run. These tests
 * import the real author lists, so a drift there fails the build.
 */

import { describe, expect, it } from 'vitest'

import { decodeComment, renderEventComment } from '../src/adapters/github/ledger'
import { ALLOWED_AUTHORIZERS, TRUSTED_LEDGER_AUTHORS } from '../src/config/scaffold-config'
import { currentOpenWait, resumeFromWaitingHuman } from '../src/domain/state-machine'
import type { LedgerEvent } from '../src/domain/schema'
import { SCAFFOLD_LIMITS } from '../src/config/scaffold-config'
import { runOrchestration } from '../src/runner'
import {
  FIXED_NOW,
  implementerOutput,
  makeHarness,
  quietCaptures,
  reviewerOutput,
  workspaceState,
} from './helpers'

const OWNER = ALLOWED_AUTHORIZERS[0]
const BOT = TRUSTED_LEDGER_AUTHORS[0]
const RUN_ID = 'run-test-001'

const TRUST = {
  machineAuthors: [...TRUSTED_LEDGER_AUTHORS],
  humanAuthorizers: [...ALLOWED_AUTHORIZERS],
}

function authorization(
  overrides: Partial<Extract<LedgerEvent, { event: 'human_authorization' }>> = {}
): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: RUN_ID,
    at: FIXED_NOW.toISOString(),
    event: 'human_authorization',
    authorized_by: OWNER,
    wait_id: 'wait-1',
    grants: ['policy_violation'],
    resume_state: 'GPT_TURN',
    expires_at: new Date(FIXED_NOW.getTime() + 600_000).toISOString(),
    ...overrides,
  }
}

function waitEvent(id: string, blockingReason = 'policy_violation'): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: RUN_ID,
    at: FIXED_NOW.toISOString(),
    event: 'state_changed',
    from: 'CLAUDE_TURN',
    to: 'WAITING_HUMAN',
    reason: 'blocked',
    wait: { id, blocking_reason: blockingReason },
    consumed_wait_id: null,
  }
}

function resumeEvent(consumedWaitId: string): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: RUN_ID,
    at: FIXED_NOW.toISOString(),
    event: 'state_changed',
    from: 'WAITING_HUMAN',
    to: 'GPT_TURN',
    reason: 'resumed',
    wait: null,
    consumed_wait_id: consumedWaitId,
  }
}

function comment(author: string, event: LedgerEvent, id = 1) {
  return {
    id,
    author_login: author,
    body: renderEventComment(event),
    created_at: FIXED_NOW.toISOString(),
  }
}

const resume = (events: readonly LedgerEvent[], now = FIXED_NOW) =>
  resumeFromWaitingHuman({ runId: RUN_ID, events, allowedAuthorizers: [OWNER], now })

// ─────────────────────────────────────────────────────────────────────────────
// One authorization releases one block
// ─────────────────────────────────────────────────────────────────────────────

describe('an authorization is spent on the block it names', () => {
  it('1. the first authorization releases the first wait', () => {
    const decision = resume([waitEvent('wait-1'), authorization({ wait_id: 'wait-1' })])
    expect(decision).toMatchObject({ resumed: true, state: 'GPT_TURN', consumed_wait_id: 'wait-1' })
  })

  it('2. a second wait cannot reuse the first authorization', () => {
    // This is the defect: the round-2 approval is still unexpired, and under the
    // old rule it silently released the round-5 block too.
    const events = [
      waitEvent('wait-1'),
      authorization({ wait_id: 'wait-1' }),
      resumeEvent('wait-1'),
      waitEvent('wait-2'),
    ]
    const decision = resume(events)
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('wait-2')
  })

  it('3. an authorization naming a different wait is not an authorization for this one', () => {
    const decision = resume([waitEvent('wait-2'), authorization({ wait_id: 'wait-1' })])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('no authorization names wait "wait-2"')
  })

  it('4a. an authorization written before its wait does not count', () => {
    // Ordering matters: approving something that has not happened yet is not
    // approval, it is a blank cheque.
    const decision = resume([authorization({ wait_id: 'wait-1' }), waitEvent('wait-1')])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('predates the wait')
  })

  it('4b. an expired authorization does not count', () => {
    const decision = resume([
      waitEvent('wait-1'),
      authorization({ expires_at: new Date(FIXED_NOW.getTime() - 1).toISOString() }),
    ])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('expired')
  })

  it('4c. an already-consumed authorization does not count', () => {
    const events = [waitEvent('wait-1'), authorization({ wait_id: 'wait-1' }), resumeEvent('wait-1')]
    expect(currentOpenWait(events, RUN_ID)).toBeNull()
    expect(resume(events).resumed).toBe(false)
  })

  it('5. a fresh authorization for the second wait resumes it', () => {
    const events = [
      waitEvent('wait-1'),
      authorization({ wait_id: 'wait-1' }),
      resumeEvent('wait-1'),
      waitEvent('wait-2'),
      authorization({ wait_id: 'wait-2' }),
    ]
    expect(resume(events)).toMatchObject({ resumed: true, consumed_wait_id: 'wait-2' })
  })
})

describe('grants must cover the reason the run is actually blocked on', () => {
  it('refuses an approval that does not name the blocking reason', () => {
    const decision = resume([
      waitEvent('wait-1', 'self_report_mismatch'),
      authorization({ wait_id: 'wait-1', grants: ['cost_overrun'] }),
    ])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('blocked on "self_report_mismatch"')
  })

  it('accepts an approval that names it', () => {
    expect(
      resume([
        waitEvent('wait-1', 'self_report_mismatch'),
        authorization({ wait_id: 'wait-1', grants: ['self_report_mismatch'] }),
      ]).resumed
    ).toBe(true)
  })

  it('refuses an authorizer who is not on the allowlist', () => {
    const decision = resume([
      waitEvent('wait-1'),
      authorization({ authorized_by: 'drive-by-contributor' }),
    ])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('not on the allowlist')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Decode-time trust
// ─────────────────────────────────────────────────────────────────────────────

describe('the owner can actually reach the ledger', () => {
  it("accepts the owner's own authorization at decode time", () => {
    expect(decodeComment(comment(OWNER, authorization()), TRUST)).toEqual({
      event: authorization(),
    })
  })

  it('rejects a marker whose authorized_by is not the comment author', () => {
    const decoded = decodeComment(comment('drive-by-contributor', authorization()), TRUST)
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain('untrusted author')
  })

  it("rejects the bot minting an authorization on the owner's behalf", () => {
    const decoded = decodeComment(comment(BOT, authorization()), TRUST)
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain(
      'may not mint a human authorization'
    )
  })

  it('rejects the owner claiming to be somebody else', () => {
    const decoded = decodeComment(
      comment(OWNER, authorization({ authorized_by: 'someone-with-more-rights' })),
      TRUST
    )
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain('GitHub says')
  })

  it('rejects a human writing any other kind of event', () => {
    const machineEvent: LedgerEvent = {
      schema_version: 'v1',
      run_id: RUN_ID,
      at: FIXED_NOW.toISOString(),
      event: 'run_finished',
      final_state: 'APPROVED_FOR_HUMAN_MERGE',
      stop_reason: 'reviewer_approved',
    }
    const decoded = decodeComment(comment(OWNER, machineEvent), TRUST)
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain(
      'may only write human_authorization'
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// End to end, through the runner, with the real config
// ─────────────────────────────────────────────────────────────────────────────

describe('end to end with the real scaffold author lists', () => {
  it('parks, then resumes on the owner comment, then parks again on the next block', async () => {
    // Round 1: the implementer breaches scope, so the run parks on a named wait.
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        { output: implementerOutput({ files_changed: ['src/lib/forbidden.ts'] }) },
        { output: implementerOutput({ files_changed: ['src/lib/forbidden-again.ts'] }) },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) }],
      workspace: [
        workspaceState({ file_fingerprints: {} }),
        workspaceState({ file_fingerprints: { 'src/lib/forbidden.ts': 'v1' } }),
      ],
    })

    const parked = await runOrchestration(h.input, h.deps)
    expect(parked.run.state).toBe('WAITING_HUMAN')

    const firstWait = parked.appended.find(
      (event) => event.event === 'turn_rejected' && event.wait !== null
    )
    expect(firstWait && 'wait' in firstWait && firstWait.wait?.id).toBeTruthy()
    const waitId = firstWait && 'wait' in firstWait ? (firstWait.wait?.id as string) : ''
    const blockingReason = firstWait && 'wait' in firstWait ? (firstWait.wait?.blocking_reason as string) : ''

    // Re-dispatching without an approval changes nothing.
    const stillParked = await runOrchestration(h.input, h.deps)
    expect(stillParked.run.state).toBe('WAITING_HUMAN')

    // The owner approves *this* wait, naming the reason.
    h.github.seedComment({
      author_login: OWNER,
      body: renderEventComment(
        authorization({ wait_id: waitId, grants: [blockingReason], resume_state: 'GPT_TURN' })
      ),
      created_at: FIXED_NOW.toISOString(),
    })

    const resumed = await runOrchestration(h.input, h.deps)
    expect(resumed.appended.some((event) => event.event === 'state_changed' && event.consumed_wait_id === waitId)).toBe(true)
  })

  it('does not resume on a forged authorization, end to end', async () => {
    const h = makeHarness({ runOverrides: { state: 'WAITING_HUMAN', current_round: 1 } })

    h.github.seedComment({
      author_login: 'drive-by-contributor',
      body: renderEventComment(authorization()),
      created_at: FIXED_NOW.toISOString(),
    })
    h.github.seedComment({
      author_login: BOT,
      body: renderEventComment(authorization()),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(h.reviewer.callCount).toBe(0)
    expect(result.preflight.ledger_rejected).toHaveLength(2)
  })
})

/**
 * The third defect of the same family, found later: a reviewer verdict of
 * WAITING_HUMAN or STOP_POLICY_VIOLATION parks the run on a turn that
 * **completed**, and `turn_completed` carried no wait descriptor. `currentOpenWait`
 * only read `turn_rejected` and `state_changed`, so it reported "no open wait" —
 * and since an authorization must name the wait it releases, there was nothing to
 * name. The run was unreleasable by anyone, which is a worse failure than the
 * over-broad approval this whole mechanism was built to prevent.
 */
describe('a reviewer verdict that parks the run can still be released', () => {
  function parkedByVerdict(verdict: 'WAITING_HUMAN' | 'STOP_POLICY_VIOLATION') {
    return makeHarness({
      reviewerScript: [
        { output: reviewerOutput({ verdict, human_question: 'Upgrade the plan?' }) },
        { output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) },
      ],
      workspace: quietCaptures(),
    })
  }

  it.each(['WAITING_HUMAN', 'STOP_POLICY_VIOLATION'] as const)(
    'opens a named wait on a %s verdict',
    async (verdict) => {
      const h = parkedByVerdict(verdict)

      const result = await runOrchestration(h.input, h.deps)

      expect(result.run.state).toBe('WAITING_HUMAN')
      const completed = result.appended.find((event) => event.event === 'turn_completed')
      expect(completed && 'wait' in completed && completed.wait?.id).toBeTruthy()
      expect(completed && 'wait' in completed && completed.wait?.blocking_reason).toBe(
        verdict === 'STOP_POLICY_VIOLATION'
          ? 'reviewer_stop_policy_violation'
          : 'reviewer_waiting_human'
      )
    }
  )

  it('reports that wait as the open one, so an approval has something to name', async () => {
    const h = parkedByVerdict('WAITING_HUMAN')
    const result = await runOrchestration(h.input, h.deps)

    const open = currentOpenWait(result.appended, RUN_ID)
    expect(open).not.toBeNull()
    expect(open?.blocking_reason).toBe('reviewer_waiting_human')
  })

  it('resumes end to end once the owner approves that specific wait', async () => {
    const h = parkedByVerdict('WAITING_HUMAN')
    const parked = await runOrchestration(h.input, h.deps)

    const completed = parked.appended.find((event) => event.event === 'turn_completed')
    const waitId = completed && 'wait' in completed ? (completed.wait?.id as string) : ''
    expect(waitId).toBeTruthy()

    h.github.seedComment({
      author_login: OWNER,
      body: renderEventComment(
        authorization({
          wait_id: waitId,
          grants: ['reviewer_waiting_human'],
          resume_state: 'GPT_TURN',
        })
      ),
      created_at: FIXED_NOW.toISOString(),
    })

    const resumed = await runOrchestration(h.input, h.deps)

    expect(
      resumed.appended.some(
        (event) => event.event === 'state_changed' && event.consumed_wait_id === waitId
      )
    ).toBe(true)
    expect(resumed.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
  })

  it('still refuses an approval that names a different wait — the negative control', async () => {
    const h = parkedByVerdict('WAITING_HUMAN')
    await runOrchestration(h.input, h.deps)

    h.github.seedComment({
      author_login: OWNER,
      body: renderEventComment(
        authorization({
          wait_id: 'wait-someone-elses',
          grants: ['reviewer_waiting_human'],
          resume_state: 'GPT_TURN',
        })
      ),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)
    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.stopped_because).toContain('no authorization names wait')
  })

  it('still refuses an approval that does not grant the blocking reason', async () => {
    const h = parkedByVerdict('STOP_POLICY_VIOLATION')
    const parked = await runOrchestration(h.input, h.deps)
    const completed = parked.appended.find((event) => event.event === 'turn_completed')
    const waitId = completed && 'wait' in completed ? (completed.wait?.id as string) : ''

    h.github.seedComment({
      author_login: OWNER,
      body: renderEventComment(
        authorization({ wait_id: waitId, grants: ['carry_on'], resume_state: 'GPT_TURN' })
      ),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)
    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.stopped_because).toContain('reviewer_stop_policy_violation')
  })

  it('gives the second reviewer block a fresh id, not the one already approved', async () => {
    // The dangerous case, and the reason `nextWaitId` has to count reviewer waits
    // too: two *consecutive* blocks that both arrive on `turn_completed`. If the
    // counter cannot see the first one, the second is minted with the same id —
    // and an id is exactly what an approval names. One signature, two gates.
    const h = makeHarness({
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'plan ok?' }) },
        { output: reviewerOutput({ verdict: 'STOP_POLICY_VIOLATION', summary: 'envelope breached' }) },
      ],
      workspace: quietCaptures(),
    })

    const first = await runOrchestration(h.input, h.deps)
    const firstCompleted = first.appended.find((event) => event.event === 'turn_completed')
    const firstWaitId = firstCompleted && 'wait' in firstCompleted ? firstCompleted.wait?.id : null
    expect(firstWaitId).toBeTruthy()

    // The owner clears block one, and only block one.
    h.github.seedComment({
      author_login: OWNER,
      body: renderEventComment(
        authorization({
          wait_id: firstWaitId as string,
          grants: ['reviewer_waiting_human'],
          resume_state: 'GPT_TURN',
        })
      ),
      created_at: FIXED_NOW.toISOString(),
    })

    const second = await runOrchestration(h.input, h.deps)
    const secondCompleted = second.appended.find((event) => event.event === 'turn_completed')
    const secondWaitId = secondCompleted && 'wait' in secondCompleted ? secondCompleted.wait?.id : null

    expect(second.run.state).toBe('WAITING_HUMAN')
    expect(secondWaitId).toBeTruthy()
    expect(secondWaitId).not.toBe(firstWaitId)
    expect(secondCompleted && 'wait' in secondCompleted && secondCompleted.wait?.blocking_reason).toBe(
      'reviewer_stop_policy_violation'
    )

    // And a third dispatch stays parked: nothing has approved the new block.
    const third = await runOrchestration(h.input, h.deps)
    expect(third.run.state).toBe('WAITING_HUMAN')
    expect(third.stopped_because).toContain('waiting for human')
  })
})

describe('the two author lists have to stay consistent with each other', () => {
  it('does not put a human authorizer on the machine list, or vice versa', () => {
    for (const human of ALLOWED_AUTHORIZERS) expect(TRUSTED_LEDGER_AUTHORS).not.toContain(human)
    for (const machine of TRUSTED_LEDGER_AUTHORS) expect(ALLOWED_AUTHORIZERS).not.toContain(machine)
  })

  it('leaves neither list empty, which would close the gate in one direction', () => {
    expect(TRUSTED_LEDGER_AUTHORS.length).toBeGreaterThan(0)
    expect(ALLOWED_AUTHORIZERS.length).toBeGreaterThan(0)
  })
})
