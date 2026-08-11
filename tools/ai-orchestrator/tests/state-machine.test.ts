import { describe, expect, it } from 'vitest'

import { IllegalTransitionError } from '../src/domain/errors'
import type { LedgerEvent, RunState } from '../src/domain/schema'
import {
  actorForState,
  allowedTransitionsFrom,
  assertTransition,
  canTransition,
  initialTurnState,
  isTerminal,
  nextStateForVerdict,
  resumeFromWaitingHuman,
} from '../src/domain/state-machine'

const NOW = new Date('2026-08-07T00:00:00.000Z')

describe('legal transitions', () => {
  it('allows the ordinary review cycle', () => {
    expect(canTransition('READY', 'GPT_TURN')).toBe(true)
    expect(canTransition('GPT_TURN', 'CLAUDE_TURN')).toBe(true)
    expect(canTransition('CLAUDE_TURN', 'GPT_TURN')).toBe(true)
    expect(canTransition('GPT_TURN', 'APPROVED_FOR_HUMAN_MERGE')).toBe(true)
  })

  it('rejects transitions that skip the reviewer', () => {
    expect(canTransition('READY', 'APPROVED_FOR_HUMAN_MERGE')).toBe(false)
    expect(canTransition('CLAUDE_TURN', 'APPROVED_FOR_HUMAN_MERGE')).toBe(false)
  })

  it('throws a typed error on an illegal transition', () => {
    expect(() => assertTransition('CLAUDE_TURN', 'APPROVED_FOR_HUMAN_MERGE')).toThrow(
      IllegalTransitionError
    )
  })
})

describe('terminal states', () => {
  const terminals: RunState[] = [
    'APPROVED_FOR_HUMAN_MERGE',
    'FAILED',
    'BUDGET_EXHAUSTED',
    'CANCELLED',
  ]

  it.each(terminals)('%s has no outgoing transitions', (state) => {
    expect(isTerminal(state)).toBe(true)
    expect(allowedTransitionsFrom(state)).toHaveLength(0)
    expect(actorForState(state)).toBeNull()
  })

  it('a terminal run cannot be restarted by any state', () => {
    for (const terminal of terminals) {
      for (const target of ['GPT_TURN', 'CLAUDE_TURN', 'READY'] as RunState[]) {
        expect(canTransition(terminal, target)).toBe(false)
      }
    }
  })
})

describe('actor routing', () => {
  it('maps turn states to their owning actor', () => {
    expect(actorForState('GPT_TURN')).toBe('gpt_reviewer')
    expect(actorForState('CLAUDE_TURN')).toBe('claude_implementer')
    expect(actorForState('WAITING_HUMAN')).toBeNull()
  })

  it('starts DESIGN and REVIEW with the reviewer, IMPLEMENT with the implementer', () => {
    expect(initialTurnState('DESIGN')).toBe('GPT_TURN')
    expect(initialTurnState('REVIEW')).toBe('GPT_TURN')
    expect(initialTurnState('IMPLEMENT')).toBe('CLAUDE_TURN')
  })
})

describe('verdict mapping', () => {
  it('only ends the run on approval in REVIEW mode', () => {
    expect(nextStateForVerdict('REVIEW', 'APPROVED_FOR_NEXT_STAGE')).toBe('APPROVED_FOR_HUMAN_MERGE')
    expect(nextStateForVerdict('DESIGN', 'APPROVED_FOR_NEXT_STAGE')).toBe('CLAUDE_TURN')
    expect(nextStateForVerdict('IMPLEMENT', 'APPROVED_FOR_NEXT_STAGE')).toBe('CLAUDE_TURN')
  })

  it('parks policy violations where a human has to look', () => {
    expect(nextStateForVerdict('REVIEW', 'STOP_POLICY_VIOLATION')).toBe('WAITING_HUMAN')
    expect(nextStateForVerdict('REVIEW', 'WAITING_HUMAN')).toBe('WAITING_HUMAN')
  })
})

describe('WAITING_HUMAN never resumes on its own', () => {
  // The binding rules themselves are exercised in human-authorization.test.ts,
  // against the real scaffold config. This only pins the empty case.
  it('stays parked when the ledger holds nothing at all', () => {
    const decision = resumeFromWaitingHuman({
      runId: 'run-1',
      events: [],
      allowedAuthorizers: ['bigbigraydeng-maker'],
      now: NOW,
    })
    expect(decision).toMatchObject({ resumed: false, state: 'WAITING_HUMAN', consumed_wait_id: null })
    expect(decision.reason).toContain('no open wait')
  })

  it('stays parked when unrelated events arrive', () => {
    const events: LedgerEvent[] = [
      {
        schema_version: 'v1', run_id: 'run-1', at: NOW.toISOString(),
        event: 'lease_released', lock_key: 'o/r#1', holder: 'gha-1', lease_id: 'lease-1',
      },
    ]
    expect(
      resumeFromWaitingHuman({ runId: 'run-1', events, allowedAuthorizers: ['x'], now: NOW }).resumed
    ).toBe(false)
  })
})
