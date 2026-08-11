/**
 * The model does not get to describe its own turn into compliance — and the
 * record it is checked against is *this turn's* record, not the whole branch's.
 *
 * The second half matters as much as the first. A cumulative
 * `git diff base...HEAD` makes round 1's files look like round 2's work, makes
 * `commit` non-null forever because HEAD always exists, and turns an honest
 * implementer into a liar. So the inspector captures states and the runner diffs
 * a pair around every call.
 *
 * Each negative test has a positive control, so "the run halted" is never
 * mistaken for "the runner halts on everything".
 */

import { describe, expect, it } from 'vitest'

import {
  GitControlPlaneIntegrityChecker,
  GitWorkspaceInspector,
  parseNameStatus,
  parsePorcelain,
} from '../src/adapters/workspace/git-inspector'
import type { CommandRunner } from '../src/adapters/workspace/git-inspector'
import { GitHubPullRequestInspector, selectInspector } from '../src/adapters/workspace/github-pr-inspector'
import { InMemoryGitHubClient } from '../src/adapters/github/memory-client'
import {
  DELETED_FINGERPRINT,
  StaticWorkspaceInspector,
  diffWorkspaceStates,
} from '../src/adapters/workspace/inspector'
import { TELEMETRY_UNAVAILABLE } from '../src/adapters/provider-types'
import { workPackageScopeSchema } from '../src/domain/schema'
import { enforceToolUse } from '../src/policy/policy'
import {
  SCAFFOLD_ALLOWED_TOOLS,
  SCAFFOLD_DISALLOWED_TOOLS,
  createScaffoldAuthorization,
} from '../src/config/scaffold-config'
import { runOrchestration } from '../src/runner'
import {
  FIXED_NOW,
  IN_SCOPE_FILE,
  fingerprints,
  implementerOutput,
  makeHarness,
  reviewerOutput,
  workspaceState,
} from './helpers'

function rejection(result: Awaited<ReturnType<typeof runOrchestration>>) {
  return result.appended.find((event) => event.event === 'turn_rejected')
}

const OTHER_IN_SCOPE = 'docs/specs/second-file.md'

const SCAFFOLD_AUTH = createScaffoldAuthorization({
  workPackageId: 'wp-860',
  now: FIXED_NOW,
  authorizationSource: 'issue#860',
})

describe('a turn is judged on its own delta, not the whole branch', () => {
  it('does not blame round 2 for the files round 1 changed', async () => {
    // Round 1 edits IN_SCOPE_FILE. Round 2 edits OTHER_IN_SCOPE and leaves the
    // first file alone — its fingerprint is unchanged, so it is not round 2's work.
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        { output: implementerOutput({ files_changed: [IN_SCOPE_FILE] }) },
        { output: implementerOutput({ files_changed: [OTHER_IN_SCOPE] }) },
      ],
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) },
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'done?' }) },
      ],
      // Every turn consumes a before/after pair, the reviewer's included — and the
      // reviewer's pair has to be quiet or its own read-only check fires.
      workspace: [
        // round 1, implementer: before / after
        workspaceState({ file_fingerprints: {} }),
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE]) }),
        // round 2, reviewer: quiet
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE]) }),
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE]) }),
        // round 3, implementer: before / after — IN_SCOPE_FILE keeps its fingerprint
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE]) }),
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE, OTHER_IN_SCOPE]) }),
        // round 4, reviewer: quiet (the last entry repeats)
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(rejection(result)).toBeUndefined()
    expect(h.implementer.callCount).toBe(2)

    const turns = result.appended.filter(
      (event) => event.event === 'turn_completed' && event.actor === 'claude_implementer'
    )
    expect(turns).toHaveLength(2)

    const first = turns[0]
    const second = turns[1]
    expect(first.event === 'turn_completed' && first.authoritative?.files_changed).toEqual([
      IN_SCOPE_FILE,
    ])
    // The point of the whole exercise: round 2's delta is only round 2's file.
    expect(second.event === 'turn_completed' && second.authoritative?.files_changed).toEqual([
      OTHER_IN_SCOPE,
    ])
    expect(
      second.event === 'turn_completed' && second.authoritative?.cumulative_files_changed
    ).toEqual([IN_SCOPE_FILE, OTHER_IN_SCOPE])
  })

  it('sees a file touched again in round 2 as round 2 work', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput({ files_changed: [IN_SCOPE_FILE] }) }],
      reviewerScript: [
        { output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) },
        { output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'done?' }) },
      ],
      workspace: [
        // round 1, implementer
        workspaceState({ file_fingerprints: {} }),
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE], 'v1') }),
        // round 2, reviewer: quiet
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE], 'v1') }),
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE], 'v1') }),
        // round 3, implementer: same path, new content
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE], 'v1') }),
        workspaceState({ file_fingerprints: fingerprints([IN_SCOPE_FILE], 'v2') }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(rejection(result)).toBeUndefined()
    const turns = result.appended.filter(
      (event) => event.event === 'turn_completed' && event.actor === 'claude_implementer'
    )
    const second = turns[1]
    expect(second.event === 'turn_completed' && second.authoritative?.files_changed).toEqual([
      IN_SCOPE_FILE,
    ])
  })

  it('does not treat an existing HEAD as a commit this turn', async () => {
    // can_commit is false and the repository already has a HEAD from before the
    // run. A cumulative view would call that a violation; a delta does not.
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      workspace: [
        workspaceState({ head_sha: 'preexisting-head', file_fingerprints: {} }),
        workspaceState({
          head_sha: 'preexisting-head',
          file_fingerprints: fingerprints([IN_SCOPE_FILE]),
        }),
      ],
    })
    const readOnly = {
      ...h.input,
      authorization: {
        ...h.authorization,
        scope: { ...h.authorization.scope, can_commit: false },
      },
    }

    const result = await runOrchestration(readOnly, h.deps)

    expect(rejection(result)).toBeUndefined()
    expect(h.implementer.callCount).toBe(1)
  })

  it('still catches a commit the turn actually made — the positive control', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      workspace: [
        workspaceState({ head_sha: 'preexisting-head', file_fingerprints: {} }),
        workspaceState({
          head_sha: 'brand-new-commit',
          file_fingerprints: fingerprints([IN_SCOPE_FILE]),
        }),
      ],
    })
    const readOnly = {
      ...h.input,
      authorization: {
        ...h.authorization,
        scope: { ...h.authorization.scope, can_commit: false },
      },
    }

    const result = await runOrchestration(readOnly, h.deps)

    const rejected = rejection(result)
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('COMMIT_NOT_AUTHORIZED')
  })

  it('does not treat a pre-existing pull request as opened this turn', async () => {
    const existing = { number: 861, head_sha: 'abc', head_ref: 'claude/x', merged: false }
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            commit_evidence: { branch: 'claude/x', commit_sha: 'sha2', pr_number: 861 },
          }),
        },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      workspace: [
        workspaceState({ head_sha: 'sha1', pull_request: existing, file_fingerprints: {} }),
        workspaceState({
          head_sha: 'sha2',
          pull_request: existing,
          file_fingerprints: fingerprints([IN_SCOPE_FILE]),
        }),
      ],
    })
    const noPr = {
      ...h.input,
      authorization: {
        ...h.authorization,
        scope: { ...h.authorization.scope, can_open_draft_pr: false },
      },
    }

    const result = await runOrchestration(noPr, h.deps)

    // The PR existed before this turn, so this turn did not open one.
    expect(rejection(result)).toBeUndefined()
  })
})

describe('diffWorkspaceStates', () => {
  const before = workspaceState({
    head_sha: 'a',
    file_fingerprints: { 'kept.ts': 'h1', 'changed.ts': 'h2', 'gone.ts': 'h3' },
  })
  const after = workspaceState({
    head_sha: 'b',
    file_fingerprints: { 'kept.ts': 'h1', 'changed.ts': 'h2-new', 'added.ts': 'h4' },
  })
  const delta = diffWorkspaceStates(before, after)

  it('reports only what moved', () => {
    expect(delta.files_changed).toEqual(['added.ts', 'changed.ts', 'gone.ts'])
  })

  it('keeps the cumulative view separately', () => {
    expect(delta.cumulative_files_changed).toEqual(['added.ts', 'changed.ts', 'kept.ts'])
  })

  it('reports a commit only when HEAD moved', () => {
    expect(delta.commit).toEqual({ sha: 'b', branch: 'claude/x' })
    expect(diffWorkspaceStates(before, { ...after, head_sha: 'a' }).commit).toBeNull()
  })

  it('reports a pull request as new only when there was none before', () => {
    const pr = { number: 1, head_sha: 'b', head_ref: 'x', merged: false }
    expect(diffWorkspaceStates(before, { ...after, pull_request: pr }).pull_request_opened_this_turn).toBe(true)
    expect(
      diffWorkspaceStates({ ...before, pull_request: pr }, { ...after, pull_request: pr })
        .pull_request_opened_this_turn
    ).toBe(false)
  })
})

describe('a lie about files_changed is caught by the real record', () => {
  it('halts when the record shows a file the model did not mention', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput({ files_changed: [IN_SCOPE_FILE] }) }],
      workspace: [
        workspaceState({ file_fingerprints: {} }),
        workspaceState({
          file_fingerprints: fingerprints([IN_SCOPE_FILE, 'src/lib/execution/auto-run-policy.ts']),
        }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = rejection(result)
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PATH_EXPLICITLY_DENIED')
  })

  it('halts when the record shows a protected file the model did not mention', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput({ files_changed: [IN_SCOPE_FILE] }) }],
      workspace: [
        workspaceState({ file_fingerprints: {} }),
        workspaceState({
          file_fingerprints: fingerprints([IN_SCOPE_FILE, 'tools/ai-orchestrator/src/policy/policy.ts']),
        }),
      ],
    })

    const rejected = rejection(await runOrchestration(h.input, h.deps))
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PROTECTED_PATH_TOUCHED')
  })

  it('halts when the model claims a file the record never saw change', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput({ files_changed: [IN_SCOPE_FILE] }) }],
      workspace: [workspaceState({ file_fingerprints: {} }), workspaceState({ file_fingerprints: {} })],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(rejection(result)).toMatchObject({ reason: 'self_report_mismatch' })
  })

  it('lets an honest turn through — the positive control', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(rejection(result)).toBeUndefined()
    expect(h.implementer.callCount).toBe(1)
  })
})

describe('an under-reported tool is caught by execution telemetry', () => {
  it('halts when the harness saw a tool the model omitted', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({ tools_used: ['Read', 'Edit'] }),
          telemetry: {
            tools_used: ['Read', 'Edit', 'Bash(gh pr merge 861 --admin)'],
            source: 'claude-code-action:execution-log',
          },
        },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = rejection(result)
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('TOOL_NOT_ALLOWED')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('Bash(gh pr merge 861 --admin)')
  })

  it('records where the tool list came from, so the claim can be audited', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        { output: implementerOutput(), telemetry: { source: 'claude-code-action:execution-log' } },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
    })

    const result = await runOrchestration(h.input, h.deps)
    const completed = result.appended.find(
      (event) => event.event === 'turn_completed' && event.actor === 'claude_implementer'
    )
    expect(completed && 'authoritative' in completed && completed.authoritative?.sources).toEqual({
      workspace: 'git:diff+status+hash-object',
      telemetry: 'claude-code-action:execution-log',
    })
  })
})

describe('telemetry that does not exist is not evidence of compliance', () => {
  it('fails the turn closed when the adapter cannot produce an execution record', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        { output: implementerOutput(), telemetry: { source: TELEMETRY_UNAVAILABLE } },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(rejection(result)).toMatchObject({ reason: 'missing_telemetry' })
  })

  it('fails the turn closed when the source is blank', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput(), telemetry: { source: '' } }],
    })

    expect(rejection(await runOrchestration(h.input, h.deps))).toMatchObject({
      reason: 'missing_telemetry',
    })
  })
})

describe('commit and pull request identity come from the adapters', () => {
  it('halts when the model invents a commit the record does not have', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            commit_evidence: { branch: 'claude/x', commit_sha: 'deadbeef', pr_number: 861 },
          }),
        },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(rejection(result)).toMatchObject({ reason: 'self_report_mismatch' })
  })

  it('takes the branch and PR number from the record, not the model', async () => {
    const pr = { number: 861, head_sha: 'sha2', head_ref: 'real-branch', merged: false }
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            commit_evidence: { branch: 'real-branch', commit_sha: 'sha2', pr_number: 861 },
          }),
        },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      workspace: [
        workspaceState({ head_sha: 'sha1', branch: 'real-branch', file_fingerprints: {} }),
        workspaceState({
          head_sha: 'sha2',
          branch: 'real-branch',
          pull_request: pr,
          file_fingerprints: fingerprints([IN_SCOPE_FILE]),
        }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(rejection(result)).toBeUndefined()
    expect(result.run.target_branch).toBe('real-branch')
    expect(result.run.pr_number).toBe(861)
  })

  it('halts when the record says the pull request is merged', async () => {
    const merged = { number: 861, head_sha: 'sha2', head_ref: 'b', merged: true }
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            commit_evidence: { branch: 'b', commit_sha: 'sha2', pr_number: 861 },
          }),
        },
      ],
      workspace: [
        workspaceState({ head_sha: 'sha1', branch: 'b', pull_request: merged, file_fingerprints: {} }),
        workspaceState({
          head_sha: 'sha2',
          branch: 'b',
          pull_request: merged,
          file_fingerprints: fingerprints([IN_SCOPE_FILE]),
        }),
      ],
    })

    const rejected = rejection(await runOrchestration(h.input, h.deps))
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PR_ALREADY_MERGED')
  })
})

describe('git inspector', () => {
  function runnerFor(outputs: Record<string, string>): CommandRunner {
    return async (command, args) => outputs[`${command} ${args.join(' ')}`] ?? ''
  }

  it('captures committed and uncommitted changes with content fingerprints', async () => {
    const inspector = new GitWorkspaceInspector({
      baseRef: 'origin/main',
      run: runnerFor({
        'git diff --name-status origin/main...HEAD': 'M\tdocs/specs/a.md\n',
        'git status --porcelain': ' M src/lib/b.ts\n?? src/lib/c.ts\n',
        'git rev-parse HEAD': 'abc1234\n',
        'git rev-parse --abbrev-ref HEAD': 'claude/x\n',
        'git hash-object -- docs/specs/a.md src/lib/b.ts src/lib/c.ts': 'h-a\nh-b\nh-c\n',
      }),
    })

    const state = await inspector.capture()

    // An agent that leaves a change uncommitted has still changed it.
    expect(state.file_fingerprints).toEqual({
      'docs/specs/a.md': 'h-a',
      'src/lib/b.ts': 'h-b',
      'src/lib/c.ts': 'h-c',
    })
    expect(state.head_sha).toBe('abc1234')
    expect(state.branch).toBe('claude/x')
    expect(state.source).toBe('git:diff+status+hash-object')
  })

  it('marks deletions instead of trying to hash a file that is gone', async () => {
    const inspector = new GitWorkspaceInspector({
      baseRef: 'origin/main',
      run: runnerFor({
        'git diff --name-status origin/main...HEAD': '',
        'git status --porcelain': ' D src/lib/gone.ts\n',
        'git rev-parse HEAD': 'abc\n',
        'git rev-parse --abbrev-ref HEAD': 'x\n',
      }),
    })

    const state = await inspector.capture()
    expect(state.file_fingerprints).toEqual({ 'src/lib/gone.ts': DELETED_FINGERPRINT })
  })

  it('counts both sides of a rename', () => {
    expect(parsePorcelain('R  old/path.ts -> new/path.ts')).toEqual([
      { path: 'old/path.ts', deleted: true },
      { path: 'new/path.ts', deleted: false },
    ])
    expect(parseNameStatus('R100\told.ts\tnew.ts')).toEqual([
      { path: 'old.ts', deleted: true },
      { path: 'new.ts', deleted: false },
    ])
  })

  it('unquotes paths git escaped', () => {
    expect(parsePorcelain('?? "src/with space.ts"')).toEqual([
      { path: 'src/with space.ts', deleted: false },
    ])
  })

  it('asks git about the protected surface for drift', async () => {
    const checker = new GitControlPlaneIntegrityChecker({
      baseRef: 'origin/main',
      run: runnerFor({
        'git diff --name-only origin/main...HEAD -- .github CODEOWNERS tools/ai-orchestrator':
          'tools/ai-orchestrator/src/runner.ts\n',
        'git status --porcelain -- .github CODEOWNERS tools/ai-orchestrator': '',
      }),
    })

    expect(await checker.drift()).toEqual(['tools/ai-orchestrator/src/runner.ts'])
  })

  it('reports intact when the protected surface did not move', async () => {
    const checker = new GitControlPlaneIntegrityChecker({ baseRef: 'origin/main', run: runnerFor({}) })
    expect(await checker.drift()).toEqual([])
  })
})

describe('GitHub PR inspector', () => {
  it('uses blob ids as fingerprints so rounds can be diffed', async () => {
    const github = new InMemoryGitHubClient()
    github.seedPullRequest({ number: 861, head_sha: 'abc', head_ref: 'claude/x', merged: false }, [
      { filename: 'docs/specs/b.md', sha: 'blob-b' },
      { filename: 'docs/specs/a.md', sha: 'blob-a' },
    ])

    const state = await new GitHubPullRequestInspector(github, 861).capture()

    expect(state.file_fingerprints).toEqual({
      'docs/specs/a.md': 'blob-a',
      'docs/specs/b.md': 'blob-b',
    })
    expect(state.pull_request).toMatchObject({ number: 861, merged: false })
    expect(state.source).toBe('github:pr-files(pages=1,files=2)')
  })

  it('prefers GitHub once a PR exists and the local view before then', () => {
    const github = new InMemoryGitHubClient()
    const local = new StaticWorkspaceInspector([workspaceState()])
    expect(selectInspector({ prNumber: null, github, local }).name).toBe('static')
    expect(selectInspector({ prNumber: 861, github, local }).name).toBe('github-pr')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pushing: a capability nothing could verify, so it is not a capability
// ─────────────────────────────────────────────────────────────────────────────

describe('a push is the remote moving, not HEAD moving', () => {
  it('stops the run when the tracked remote ref changed during the turn', async () => {
    // The defect: `can_push: false` was in the authorization and nothing read it.
    // The facts only recorded whether HEAD moved, which a local commit does too.
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      workspace: [
        workspaceState({ remote: { ref: 'origin/claude/x', head_sha: 'r1' }, file_fingerprints: {} }),
        workspaceState({
          remote: { ref: 'origin/claude/x', head_sha: 'r2' },
          file_fingerprints: fingerprints([IN_SCOPE_FILE]),
        }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = rejection(result)
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PUSH_NOT_AUTHORIZED')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain(
      'origin/claude/x: r1 -> r2'
    )
  })

  it('does not mistake a local commit for a push', async () => {
    // HEAD moves, the remote does not. Committing locally is allowed; publishing
    // is not. Conflating them would make the scaffold unusable or unsafe.
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            commit_evidence: { branch: 'claude/x', commit_sha: 'c2', pr_number: null },
          }),
        },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      workspace: [
        workspaceState({ head_sha: 'c1', remote: { ref: 'origin/claude/x', head_sha: 'r1' }, file_fingerprints: {} }),
        workspaceState({
          head_sha: 'c2',
          remote: { ref: 'origin/claude/x', head_sha: 'r1' },
          file_fingerprints: fingerprints([IN_SCOPE_FILE]),
        }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(rejection(result)).toBeUndefined()
    const completed = result.appended.find(
      (event) => event.event === 'turn_completed' && event.actor === 'claude_implementer'
    )
    expect(completed && 'authoritative' in completed && completed.authoritative?.pushed_this_turn).toBe(false)
    expect(completed && 'authoritative' in completed && completed.authoritative?.commit?.sha).toBe('c2')
  })

  it('fails closed when the remote cannot be read at all', async () => {
    // "We did not see a push" and "we could not look" are different answers, and
    // only one of them is a pass.
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      workspace: [
        workspaceState({ remote: null, remote_readable: false, file_fingerprints: {} }),
        workspaceState({
          remote: null,
          remote_readable: false,
          file_fingerprints: fingerprints([IN_SCOPE_FILE]),
        }),
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = rejection(result)
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('REMOTE_FACTS_UNAVAILABLE')
  })

  it('treats "no upstream configured" as nothing to push to, not as unknown', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      workspace: [
        workspaceState({ remote: null, remote_readable: true, file_fingerprints: {} }),
        workspaceState({ remote: null, remote_readable: true, file_fingerprints: fingerprints([IN_SCOPE_FILE]) }),
      ],
    })

    expect(rejection(await runOrchestration(h.input, h.deps))).toBeUndefined()
  })

  it('cannot be granted: can_push is not a settable field', () => {
    const parsed = workPackageScopeSchema.safeParse({
      ...SCAFFOLD_AUTH.scope,
      can_push: true,
    })
    expect(parsed.success).toBe(false)
  })

  it('hands out no push tool, and forbids force push explicitly', () => {
    expect(SCAFFOLD_ALLOWED_TOOLS.some((tool) => tool.includes('git push'))).toBe(false)
    expect(SCAFFOLD_DISALLOWED_TOOLS).toContain('Bash(git push*)')
    expect(SCAFFOLD_DISALLOWED_TOOLS).toContain('Bash(git push --force*)')

    // And the tool check enforces it, not just the list's existence.
    for (const attempt of [
      'Bash(git push origin claude/x)',
      'Bash(git push --force origin main)',
      'Bash(git push -f)',
    ]) {
      expect(enforceToolUse(SCAFFOLD_AUTH.scope, [attempt])).toMatchObject({
        allowed: false,
        code: 'TOOL_NOT_ALLOWED',
      })
    }
  })
})

describe('git inspector reads the remote', () => {
  function runnerFor(outputs: Record<string, string>, failing: string[] = []) {
    return async (command: string, args: readonly string[]) => {
      const key = `${command} ${args.join(' ')}`
      if (failing.includes(key)) throw new Error(`${key} failed`)
      return outputs[key] ?? ''
    }
  }

  const base = {
    'git diff --name-status origin/main...HEAD': '',
    'git status --porcelain': '',
    'git rev-parse HEAD': 'abc\n',
    'git rev-parse --abbrev-ref HEAD': 'claude/x\n',
  }

  it('reports the tracked upstream and its head', async () => {
    const inspector = new GitWorkspaceInspector({
      baseRef: 'origin/main',
      run: runnerFor({
        ...base,
        'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/claude/x\n',
        'git rev-parse origin/claude/x': 'r1\n',
      }),
    })

    const state = await inspector.capture()
    expect(state.remote).toEqual({ ref: 'origin/claude/x', head_sha: 'r1' })
    expect(state.remote_readable).toBe(true)
  })

  it('reports no upstream as readable-but-absent', async () => {
    const inspector = new GitWorkspaceInspector({
      baseRef: 'origin/main',
      run: runnerFor(base, ['git rev-parse --abbrev-ref --symbolic-full-name @{upstream}']),
    })

    const state = await inspector.capture()
    expect(state.remote).toBeNull()
    expect(state.remote_readable).toBe(true)
  })

  it('reports an unreadable remote as unreadable, not as absent', async () => {
    const inspector = new GitWorkspaceInspector({
      baseRef: 'origin/main',
      run: runnerFor(
        { ...base, 'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/claude/x\n' },
        ['git rev-parse origin/claude/x']
      ),
    })

    const state = await inspector.capture()
    expect(state.remote).toBeNull()
    expect(state.remote_readable).toBe(false)
  })
})
