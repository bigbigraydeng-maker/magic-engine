/**
 * The loop has to actually be a loop.
 *
 * Found in review: `draftTurn` built every round's prompt from the original task
 * brief and the static untrusted blocks, and `turn_completed` kept only an
 * `output_digest` of what the model said. So a reviewer could return
 * REQUEST_CHANGES with findings, acceptance criteria and a requested scope, and
 * none of it reached the implementer; the implementer's conclusion, test results
 * and file list never came back to the reviewer either. Two agents restating the
 * same brief at each other for six rounds is not the review-and-fix collaboration
 * the design claims, and every round would have been billed for it.
 *
 * The carrier is the ledger, because rounds do not share a process: each dispatch
 * rebuilds its state by folding Issue comments, so anything the next round needs
 * has to survive as an event.
 *
 * The negative controls matter as much as the positive ones here. A test that
 * only asserts "the prompt contains the findings" would still pass if the handoff
 * were wired to the *same* actor, or if it leaked the reviewer's requested paths
 * into the policy layer as a grant. Both are checked below.
 */

import { describe, expect, it } from 'vitest'

import {
  HANDOFF_MAX_SERIALISED,
  buildImplementerHandoff,
  buildReviewerHandoff,
  fitHandoff,
  recentHandoffs,
  renderHandoffSection,
} from '../src/domain/handoff'
import { HANDOFF_MAX_ITEMS, HANDOFF_MAX_TEXT, turnHandoffSchema } from '../src/domain/schema'
import type { AuthoritativeTurnFacts, LedgerEvent } from '../src/domain/schema'
import { implementerTurnOutputSchema, reviewerTurnOutputSchema } from '../src/domain/schema'
import { runOrchestration } from '../src/runner'
import {
  FIXED_NOW,
  IN_SCOPE_FILE,
  implementerOutput,
  makeHarness,
  quietCaptures,
  reviewerOutput,
} from './helpers'

const FINDING = 'checkBudget never reads the authorization cap'
const CRITERION = 'the tightest of run, limits and authorization must bind'

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
    sources: { workspace: 'git:test', telemetry: 'mock:execution-log' },
    ...overrides,
  }
}

describe('a reviewer finding reaches the implementer', () => {
  it('puts the previous reviewer turn into the implementer prompt', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [
        {
          output: reviewerOutput({
            verdict: 'REQUEST_CHANGES',
            findings: [
              {
                severity: 'blocker',
                evidence: FINDING,
                source_ref: 'policy.ts:checkBudget',
                reasoning: 'a cap the run config can out-vote is not a cap',
              },
            ],
            acceptance_criteria: [CRITERION],
            prohibited_next_actions: ['merge', 'enable_schedule'],
          }),
        },
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'done?' }) },
      ],
      implementerScript: [{ output: implementerOutput() }],
    })

    await runOrchestration(h.input, h.deps)

    expect(h.implementer.callCount).toBe(1)
    const prompt = h.implementer.requests[0].user
    expect(prompt).toContain(FINDING)
    expect(prompt).toContain(CRITERION)
    expect(prompt).toContain('REQUEST_CHANGES')
    expect(prompt).toContain('enable_schedule')
  })

  it('sends the implementer result back to the next reviewer turn', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            conclusion: 'Took the minimum of all three ceilings.',
            remaining_risks: ['the authorization TTL is still a guess'],
          }),
        },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
    })

    await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(1)
    const prompt = h.reviewer.requests[0].user
    expect(prompt).toContain('Took the minimum of all three ceilings.')
    expect(prompt).toContain('the authorization TTL is still a guess')
    // From the workspace record, not from the model's own files_changed.
    expect(prompt).toContain(IN_SCOPE_FILE)
  })

  it('carries the loop across a fresh process, because the ledger is the carrier', async () => {
    // Round 1 runs, parks on WAITING_HUMAN, and its handoff is written to the
    // Issue. A second dispatch with brand-new provider mocks must still see it.
    const first = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [
        {
          output: reviewerOutput({
            verdict: 'WAITING_HUMAN',
            summary: 'Needs a decision from the product owner.',
            human_question: 'Upgrade the plan?',
          }),
        },
      ],
      workspace: quietCaptures(),
    })
    await runOrchestration(first.input, first.deps)

    const handoffs = recentHandoffs(
      (await first.github.listIssueComments())
        .comments.map((comment) => comment.body)
        .flatMap((body) => {
          const match = /<!-- me2-orchestrator:v1 (\{[\s\S]*?\}) -->/.exec(body)
          return match ? [JSON.parse(match[1]) as LedgerEvent] : []
        }),
      'run-test-001'
    )

    expect(handoffs).toHaveLength(1)
    expect(handoffs[0].actor).toBe('gpt_reviewer')
    expect(handoffs[0].handoff.kind === 'reviewer' && handoffs[0].handoff.summary).toContain(
      'Needs a decision'
    )
  })

  it('does not feed an actor only its own previous turn — the negative control', async () => {
    // Wiring the handoff to the same actor would satisfy "the prompt grew" while
    // leaving the two agents talking to themselves.
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'REQUEST_CHANGES', summary: 'REVIEWER-SAID-THIS' }) },
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'done?' }) },
      ],
      implementerScript: [{ output: implementerOutput({ conclusion: 'IMPLEMENTER-SAID-THIS' }) }],
    })

    await runOrchestration(h.input, h.deps)

    // Round 2's implementer prompt has the reviewer's round 1, not its own.
    expect(h.implementer.requests[0].user).toContain('REVIEWER-SAID-THIS')
    // Round 3's reviewer prompt has both: what it said, and what came back.
    expect(h.reviewer.requests[1].user).toContain('IMPLEMENTER-SAID-THIS')
    expect(h.reviewer.requests[1].user).toContain('REVIEWER-SAID-THIS')
  })

  it('gives each round its own idempotency key, because each round is different work', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) },
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'done?' }) },
      ],
      implementerScript: [{ output: implementerOutput() }],
    })

    await runOrchestration(h.input, h.deps)

    const keys = [
      h.reviewer.requests[0].idempotency_key,
      h.implementer.requests[0].idempotency_key,
      h.reviewer.requests[1].idempotency_key,
    ]
    expect(new Set(keys).size).toBe(3)
  })
})

describe('a handoff is evidence, not permission', () => {
  it('does not widen the file scope when the reviewer asks for more', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [
        {
          output: reviewerOutput({
            verdict: 'REQUEST_CHANGES',
            allowed_next_scope: { allowed_paths: ['src/**'], notes: 'go ahead' },
          }),
        },
      ],
      implementerScript: [{ output: implementerOutput({ files_changed: ['src/lib/anything.ts'] }) }],
      workspace: [
        // reviewer: quiet
        { ...quietCaptures()[0] },
        { ...quietCaptures()[0] },
        // implementer: touches the path the reviewer "granted"
        { ...quietCaptures()[0] },
        { ...quietCaptures()[0], file_fingerprints: { 'src/lib/anything.ts': 'v1' } },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    // `src/**` is in the work package's denied_paths. A reviewer cannot lift that.
    const rejected = result.appended.find((event) => event.event === 'turn_rejected')
    expect(rejected).toMatchObject({ reason: 'policy_violation' })
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PATH_EXPLICITLY_DENIED')
    expect(result.run.state).toBe('WAITING_HUMAN')
  })

  it('labels the reviewer request as a request in the prompt itself', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN' },
      reviewerScript: [{ output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) }],
      implementerScript: [{ output: implementerOutput() }],
    })

    await runOrchestration(h.input, h.deps)

    const prompt = h.implementer.requests[0].user
    expect(prompt).toContain('NOT a grant')
    expect(prompt).toContain('cannot widen your authorized')
  })
})

describe('a handoff is bounded before it is written', () => {
  const reviewer = reviewerTurnOutputSchema.parse(
    reviewerOutput({
      summary: 'x'.repeat(5_000),
      findings: Array.from({ length: 40 }, (_unused, index) => ({
        severity: 'blocker' as const,
        evidence: `e${index}`.repeat(500),
        source_ref: `s${index}`.repeat(500),
        reasoning: `r${index}`.repeat(500),
      })),
      acceptance_criteria: Array.from({ length: 40 }, (_unused, index) => `c${index}`.repeat(500)),
    })
  )

  it('truncates every field to the schema caps, so the event always parses', () => {
    const handoff = buildReviewerHandoff(reviewer)
    expect(turnHandoffSchema.safeParse(handoff).success).toBe(true)
    expect(handoff.findings).toHaveLength(HANDOFF_MAX_ITEMS)
    expect(handoff.acceptance_criteria).toHaveLength(HANDOFF_MAX_ITEMS)
    for (const finding of handoff.findings) {
      expect(finding.evidence.length).toBeLessThanOrEqual(HANDOFF_MAX_TEXT)
    }
  })

  it('stays inside the serialised ceiling once capped', () => {
    const handoff = buildReviewerHandoff(reviewer)
    expect(JSON.stringify(handoff).length).toBeLessThanOrEqual(HANDOFF_MAX_SERIALISED)
    // An Issue comment holds 65536 characters; a handoff that cannot be posted is
    // a ledger event that never happened.
    expect(JSON.stringify(handoff).length).toBeLessThan(65_536)
  })

  it('degrades to a minimal handoff rather than writing an unpostable one', () => {
    const oversized = {
      ...buildReviewerHandoff(reviewer),
      summary: 'y'.repeat(HANDOFF_MAX_SERIALISED + 1),
    }
    const fitted = fitHandoff(oversized)
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(HANDOFF_MAX_SERIALISED)
    expect(fitted.kind === 'reviewer' && fitted.findings).toEqual([])
  })

  it('leaves a handoff that already fits completely alone — the positive control', () => {
    const small = buildReviewerHandoff(reviewerTurnOutputSchema.parse(reviewerOutput()))
    expect(fitHandoff(small)).toEqual(small)
  })
})

describe('the implementer handoff reports the record, not the self-report', () => {
  it('takes files_changed and the commit from the authoritative facts', () => {
    const output = implementerTurnOutputSchema.parse(
      implementerOutput({
        files_changed: ['docs/specs/a-file-nobody-touched.md'],
        commit_evidence: null,
      })
    )
    const handoff = buildImplementerHandoff(
      output,
      facts({
        files_changed: ['docs/specs/the-file-that-moved.md'],
        commit: { sha: 'abc123', branch: 'claude/x' },
      })
    )

    expect(handoff.files_changed).toEqual(['docs/specs/the-file-that-moved.md'])
    expect(handoff.commit_sha).toBe('abc123')
  })
})

describe('recentHandoffs', () => {
  function completed(
    actor: 'gpt_reviewer' | 'claude_implementer',
    round: number,
    summary: string
  ): LedgerEvent {
    return {
      schema_version: 'v1',
      run_id: 'r1',
      at: FIXED_NOW.toISOString(),
      event: 'turn_completed',
      actor,
      round,
      idempotency_key: `k${round}`,
      input_digest: `d${round}`,
      verdict: actor === 'gpt_reviewer' ? 'REQUEST_CHANGES' : null,
      reserved_cost_usd: 0.1,
      cost_usd: 0.05,
      pricing_version: 'mock-2026-08',
      output_digest: `o${round}`,
      authoritative: null,
      self_report_mismatches: [],
      handoff:
        actor === 'gpt_reviewer'
          ? buildReviewerHandoff(reviewerTurnOutputSchema.parse(reviewerOutput({ summary })))
          : buildImplementerHandoff(
              implementerTurnOutputSchema.parse(implementerOutput({ conclusion: summary })),
              facts()
            ),
      wait: null,
      next_state: 'CLAUDE_TURN',
    }
  }

  it('keeps the latest from each actor, oldest first', () => {
    const events = [
      completed('gpt_reviewer', 1, 'old review'),
      completed('claude_implementer', 2, 'work'),
      completed('gpt_reviewer', 3, 'new review'),
    ]
    const result = recentHandoffs(events, 'r1')

    expect(result.map((entry) => entry.round)).toEqual([2, 3])
    expect(result[1].handoff.kind === 'reviewer' && result[1].handoff.summary).toBe('new review')
  })

  it('ignores other runs sharing the same Issue', () => {
    const mine = completed('gpt_reviewer', 1, 'mine')
    const theirs = { ...completed('gpt_reviewer', 1, 'theirs'), run_id: 'r2' }
    expect(recentHandoffs([mine, theirs], 'r1')).toHaveLength(1)
  })

  it('renders nothing at all on the very first turn', () => {
    expect(renderHandoffSection([])).toBeNull()
  })
})
