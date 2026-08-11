/**
 * The orchestration state machine.
 *
 * Two properties matter more than anything else here:
 *   1. WAITING_HUMAN never resumes on its own. It only resumes when a valid,
 *      unexpired human authorization event names this run.
 *   2. Terminal states have no outgoing edges at all, so a stopped run cannot be
 *      restarted by re-running the workflow.
 */

import { IllegalTransitionError } from './errors'
import type { LedgerEvent, RunMode, RunState, Verdict } from './schema'

const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  READY: ['GPT_TURN', 'CLAUDE_TURN', 'WAITING_HUMAN', 'CANCELLED', 'BUDGET_EXHAUSTED', 'FAILED'],
  GPT_TURN: [
    'CLAUDE_TURN',
    'GPT_TURN',
    'WAITING_HUMAN',
    'APPROVED_FOR_HUMAN_MERGE',
    'FAILED',
    'BUDGET_EXHAUSTED',
    'CANCELLED',
  ],
  CLAUDE_TURN: [
    'GPT_TURN',
    'CLAUDE_TURN',
    'WAITING_HUMAN',
    'FAILED',
    'BUDGET_EXHAUSTED',
    'CANCELLED',
  ],
  // Guarded: only reachable through `resumeFromWaitingHuman`.
  WAITING_HUMAN: ['GPT_TURN', 'CLAUDE_TURN', 'CANCELLED'],
  APPROVED_FOR_HUMAN_MERGE: [],
  FAILED: [],
  BUDGET_EXHAUSTED: [],
  CANCELLED: [],
}

const TERMINAL_STATES: readonly RunState[] = [
  'APPROVED_FOR_HUMAN_MERGE',
  'FAILED',
  'BUDGET_EXHAUSTED',
  'CANCELLED',
]

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.includes(state)
}

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to)
  }
}

export function allowedTransitionsFrom(state: RunState): readonly RunState[] {
  return TRANSITIONS[state]
}

/**
 * Which agent owns the next turn. Terminal and human-blocked states own none —
 * returning `null` is what stops the runner loop.
 */
export function actorForState(state: RunState): 'gpt_reviewer' | 'claude_implementer' | null {
  if (state === 'GPT_TURN') return 'gpt_reviewer'
  if (state === 'CLAUDE_TURN') return 'claude_implementer'
  return null
}

/** Where a fresh run begins, given its mode. */
export function initialTurnState(mode: RunMode): RunState {
  return mode === 'IMPLEMENT' ? 'CLAUDE_TURN' : 'GPT_TURN'
}

/**
 * Map a reviewer verdict onto the next state.
 *
 * `APPROVED_FOR_NEXT_STAGE` only ends the run in REVIEW mode; in DESIGN and
 * IMPLEMENT modes "approved" means "the next stage may start", which is another
 * implementer turn — never an automatic merge.
 */
export function nextStateForVerdict(mode: RunMode, verdict: Verdict): RunState {
  switch (verdict) {
    case 'CONTINUE_DESIGN':
    case 'REQUEST_CHANGES':
      return 'CLAUDE_TURN'
    case 'APPROVED_FOR_NEXT_STAGE':
      return mode === 'REVIEW' ? 'APPROVED_FOR_HUMAN_MERGE' : 'CLAUDE_TURN'
    case 'WAITING_HUMAN':
      return 'WAITING_HUMAN'
    // A policy violation is a security event, not a crash: park it where a human
    // has to look at it rather than burying it in FAILED.
    case 'STOP_POLICY_VIOLATION':
      return 'WAITING_HUMAN'
    case 'FAILED':
      return 'FAILED'
  }
}

export interface ResumeDecision {
  resumed: boolean
  state: RunState
  reason: string
  /** The wait this resume consumes. Recorded so it cannot be consumed twice. */
  consumed_wait_id: string | null
}

export interface OpenWait {
  wait_id: string
  blocking_reason: string
  /** Position in the event stream. An authorization written earlier is not one. */
  index: number
}

/**
 * The block the run is currently sitting on, or null if it is not blocked.
 *
 * Every transition into WAITING_HUMAN opens a wait with a fresh id; the
 * transition out names the wait it consumed. That pairing is what stops one
 * approval from covering every future gate — which is exactly what happened when
 * `resumeFromWaitingHuman` simply took the run's most recent authorization.
 */
export function currentOpenWait(events: readonly LedgerEvent[], runId: string): OpenWait | null {
  let open: OpenWait | null = null

  events.forEach((event, index) => {
    if (event.run_id !== runId) return

    // Both kinds of turn event can park the run. A reviewer that returns
    // WAITING_HUMAN or STOP_POLICY_VIOLATION *completed* its turn — the block
    // rides on `turn_completed`, and reading only `turn_rejected` here left that
    // block invisible, so no authorization could ever name it.
    if (
      (event.event === 'turn_rejected' || event.event === 'turn_completed') &&
      event.next_state === 'WAITING_HUMAN' &&
      event.wait
    ) {
      open = { wait_id: event.wait.id, blocking_reason: event.wait.blocking_reason, index }
      return
    }

    if (event.event === 'state_changed') {
      if (event.to === 'WAITING_HUMAN' && event.wait) {
        open = { wait_id: event.wait.id, blocking_reason: event.wait.blocking_reason, index }
        return
      }
      if (event.from === 'WAITING_HUMAN' && event.consumed_wait_id) {
        if (open && open.wait_id === event.consumed_wait_id) open = null
      }
    }
  })

  return open
}

/**
 * The only door out of WAITING_HUMAN.
 *
 * A run resumes only when the ledger holds a `human_authorization` that
 * (a) names the wait the run is actually sitting on, (b) was written after that
 * wait opened, (c) comes from an allowlisted human, (d) has not expired, and
 * (e) grants the specific reason that blocked it.
 *
 * The wait-id binding is the important one. Without it a still-valid approval
 * from round 2 silently released a *different* block in round 5, so a run could
 * pass a risk gate nobody had looked at.
 */
export function resumeFromWaitingHuman(args: {
  runId: string
  events: readonly LedgerEvent[]
  allowedAuthorizers: readonly string[]
  now: Date
}): ResumeDecision {
  const { runId, events, allowedAuthorizers, now } = args
  const parked: Omit<ResumeDecision, 'reason'> = {
    resumed: false,
    state: 'WAITING_HUMAN',
    consumed_wait_id: null,
  }

  const open = currentOpenWait(events, runId)
  if (!open) {
    return { ...parked, reason: 'no open wait to authorize (or it was already consumed)' }
  }

  const candidates = events
    .map((event, index) => ({ event, index }))
    .filter(
      (entry): entry is { event: Extract<LedgerEvent, { event: 'human_authorization' }>; index: number } =>
        entry.event.event === 'human_authorization' && entry.event.run_id === runId
    )

  const forThisWait = candidates.filter((entry) => entry.event.wait_id === open.wait_id)
  if (forThisWait.length === 0) {
    return { ...parked, reason: `no authorization names wait "${open.wait_id}"` }
  }

  // An approval written before the block existed cannot be approval of it.
  const afterTheWait = forThisWait.filter((entry) => entry.index > open.index)
  if (afterTheWait.length === 0) {
    return {
      ...parked,
      reason: `authorization for wait "${open.wait_id}" predates the wait itself`,
    }
  }

  const latest = afterTheWait[afterTheWait.length - 1].event

  if (!allowedAuthorizers.includes(latest.authorized_by)) {
    return { ...parked, reason: `authorizer "${latest.authorized_by}" is not on the allowlist` }
  }

  if (Date.parse(latest.expires_at) <= now.getTime()) {
    return { ...parked, reason: 'authorization has expired' }
  }

  if (!latest.grants.includes(open.blocking_reason)) {
    return {
      ...parked,
      reason:
        `authorization grants [${latest.grants.join(', ')}] but this run is blocked on ` +
        `"${open.blocking_reason}"`,
    }
  }

  assertTransition('WAITING_HUMAN', latest.resume_state)
  return {
    resumed: true,
    state: latest.resume_state,
    reason: `resumed by ${latest.authorized_by} for wait "${open.wait_id}"`,
    consumed_wait_id: open.wait_id,
  }
}
