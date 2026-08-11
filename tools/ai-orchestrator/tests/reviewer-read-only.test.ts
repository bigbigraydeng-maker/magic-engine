/**
 * "The reviewer is read-only" had nothing enforcing it.
 *
 * Found in review, and the two halves compound:
 *
 * 1. The reviewer's tool use was checked against
 *    `authorization.scope.allowed_tools` — the **implementer's** grant. In the
 *    real scaffold config that list contains `Write`, `Edit`,
 *    `Bash(git commit*)` and `Bash(gh pr create*)`, so every one of those would
 *    have passed the check on a reviewer turn.
 * 2. The reviewer turn took no workspace snapshot and ran no integrity check, so
 *    a write that did happen had nowhere to be recorded. The turn would have been
 *    filed as a compliant read-only review.
 *
 * The fix is an independent allowlist (`REVIEWER_READ_ONLY_TOOLS`) plus the same
 * before/after pair of captures the implementer already had. These tests import
 * the **real** scaffold config, so a future widening of `SCAFFOLD_ALLOWED_TOOLS`
 * cannot quietly re-open the hole.
 */

import { describe, expect, it } from 'vitest'

import {
  SCAFFOLD_ALLOWED_TOOLS,
  createScaffoldAuthorization,
} from '../src/config/scaffold-config'
import { REVIEWER_READ_ONLY_TOOLS, enforceReviewerToolUse, evaluateReviewerTurn } from '../src/policy/policy'
import type { AuthoritativeTurnFacts } from '../src/domain/schema'
import { runOrchestration } from '../src/runner'
import {
  FIXED_NOW,
  IN_SCOPE_FILE,
  fingerprints,
  makeHarness,
  quietCaptures,
  reviewerOutput,
  workspaceState,
} from './helpers'

const SCOPE = createScaffoldAuthorization({
  workPackageId: 'wp-860',
  now: FIXED_NOW,
  authorizationSource: 'issue#860',
}).scope

function facts(overrides: Partial<AuthoritativeTurnFacts> = {}): AuthoritativeTurnFacts {
  return {
    files_changed: [],
    cumulative_files_changed: [IN_SCOPE_FILE],
    tools_used: ['Read'],
    commit: null,
    pull_request: null,
    pull_request_opened_this_turn: false,
    pushed_this_turn: false,
    remote_head_delta: null,
    remote_facts_available: true,
    sources: { workspace: 'git:test', telemetry: 'mock:execution-log' },
    ...overrides,
  }
}

describe('the reviewer does not inherit the implementer tool grant', () => {
  // Not a hand-written list: these are read out of the real work package, so the
  // test tracks the config instead of a copy of it that can drift.
  const writeTools = SCAFFOLD_ALLOWED_TOOLS.filter(
    (tool) => !REVIEWER_READ_ONLY_TOOLS.some((readOnly) => readOnly === tool)
  )

  it('the scaffold work package really does grant write tools, so this suite is not vacuous', () => {
    expect(writeTools).toContain('Write')
    expect(writeTools).toContain('Edit')
    expect(writeTools).toContain('Bash(git commit*)')
    expect(writeTools).toContain('Bash(gh pr create*)')
  })

  it.each(writeTools)('refuses a reviewer turn that used %s', (tool) => {
    const decision = enforceReviewerToolUse(SCOPE, ['Read', tool])
    expect(decision).toMatchObject({ allowed: false, code: 'REVIEWER_NOT_READ_ONLY' })
  })

  it('accepts the read-only tools — the positive control', () => {
    expect(enforceReviewerToolUse(SCOPE, [...REVIEWER_READ_ONLY_TOOLS]).allowed).toBe(true)
  })

  it('still refuses what no work package may ever grant', () => {
    expect(enforceReviewerToolUse(SCOPE, ['Bash(gh pr merge 861)'])).toMatchObject({
      allowed: false,
      code: 'TOOL_NOT_ALLOWED',
    })
  })

  it('lets a work package narrow the reviewer further, but never widen it', () => {
    const narrower = { ...SCOPE, disallowed_tools: [...SCOPE.disallowed_tools, 'Grep'] }
    expect(enforceReviewerToolUse(narrower, ['Grep']).allowed).toBe(false)

    // Widening is not expressible: allowed_tools is not consulted at all.
    const widened = { ...SCOPE, allowed_tools: [...SCOPE.allowed_tools, 'Bash(rm -rf /)'] }
    expect(enforceReviewerToolUse(widened, ['Bash(rm -rf /)']).allowed).toBe(false)
  })
})

describe('the repository is asked whether the reviewer wrote anything', () => {
  it('refuses when the working tree moved during the turn', () => {
    expect(evaluateReviewerTurn(facts({ files_changed: ['docs/specs/x.md'] }))).toMatchObject({
      allowed: false,
      code: 'REVIEWER_NOT_READ_ONLY',
    })
  })

  it('refuses when the turn committed', () => {
    expect(evaluateReviewerTurn(facts({ commit: { sha: 'abc', branch: 'claude/x' } }))).toMatchObject({
      allowed: false,
      code: 'REVIEWER_NOT_READ_ONLY',
    })
  })

  it('refuses when the tracked remote moved', () => {
    expect(
      evaluateReviewerTurn(
        facts({
          pushed_this_turn: true,
          remote_head_delta: { ref: 'origin/claude/x', before_sha: 'a', after_sha: 'b' },
        })
      )
    ).toMatchObject({ allowed: false, code: 'REVIEWER_NOT_READ_ONLY' })
  })

  it('refuses when the turn opened a pull request', () => {
    expect(
      evaluateReviewerTurn(
        facts({
          pull_request_opened_this_turn: true,
          pull_request: { number: 9, head_sha: 'a', head_ref: 'claude/x', merged: false },
        })
      )
    ).toMatchObject({ allowed: false, code: 'REVIEWER_NOT_READ_ONLY' })
  })

  it('fails closed when the remote could not be read', () => {
    expect(evaluateReviewerTurn(facts({ remote_facts_available: false }))).toMatchObject({
      allowed: false,
      code: 'REMOTE_FACTS_UNAVAILABLE',
    })
  })

  it('does not blame the reviewer for what earlier rounds left behind', () => {
    // The cumulative set is non-empty on every round after the first. Judging the
    // reviewer on it would fire on every honest run.
    expect(
      evaluateReviewerTurn(
        facts({ files_changed: [], cumulative_files_changed: [IN_SCOPE_FILE, 'docs/specs/b.md'] })
      ).allowed
    ).toBe(true)
  })

  it('does not blame the reviewer for a commit that existed before the turn', () => {
    // `commit` is the delta — non-null only when HEAD moved during this turn.
    expect(evaluateReviewerTurn(facts({ commit: null })).allowed).toBe(true)
  })
})

describe('end to end: a writing reviewer is caught and the run parks', () => {
  it('halts on a reviewer turn whose telemetry shows a write tool', async () => {
    const h = makeHarness({
      reviewerScript: [
        {
          output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }),
          telemetry: { tools_used: ['Read', 'Edit'], source: 'mock:execution-log' },
        },
      ],
      workspace: quietCaptures(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('policy_violation')
    const rejected = result.appended.find((event) => event.event === 'turn_rejected')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('REVIEWER_NOT_READ_ONLY')
  })

  it('halts on a reviewer turn that changed a file even with clean telemetry', async () => {
    // The write did not go through a tool the harness names. The tool allowlist
    // sees nothing wrong; the workspace record does.
    const h = makeHarness({
      reviewerScript: [
        {
          output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }),
          telemetry: { tools_used: ['Read'], source: 'mock:execution-log' },
        },
      ],
      workspace: [
        workspaceState({ file_fingerprints: {} }),
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE]) }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = result.appended.find((event) => event.event === 'turn_rejected')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('REVIEWER_NOT_READ_ONLY')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain(IN_SCOPE_FILE)
  })

  it('halts on control-plane drift during a reviewer turn', async () => {
    const h = makeHarness({
      reviewerScript: [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }],
      workspace: quietCaptures(),
      drift: ['tools/ai-orchestrator/src/policy/policy.ts'],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.appended.find((event) => event.event === 'turn_rejected')).toMatchObject({
      reason: 'policy_integrity_drift',
    })
  })

  it('lets a genuinely read-only reviewer through — the positive control', async () => {
    const h = makeHarness({
      reviewerScript: [
        {
          output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }),
          telemetry: { tools_used: ['Read', 'Grep', 'Bash(git diff main)'], source: 'mock:execution-log' },
        },
      ],
      workspace: quietCaptures(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.appended.some((event) => event.event === 'turn_rejected')).toBe(false)
    expect(result.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
  })

  it('records the reviewer turn against the authoritative record, not against nothing', async () => {
    const h = makeHarness({
      reviewerScript: [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }],
      workspace: quietCaptures(),
    })

    const result = await runOrchestration(h.input, h.deps)

    const completed = result.appended.find((event) => event.event === 'turn_completed')
    expect(completed && 'authoritative' in completed && completed.authoritative).not.toBeNull()
    expect(
      completed && 'authoritative' in completed && completed.authoritative?.files_changed
    ).toEqual([])
  })
})
