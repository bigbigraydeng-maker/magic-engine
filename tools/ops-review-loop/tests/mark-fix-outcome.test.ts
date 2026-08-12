import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const createIssueComment = vi.fn().mockResolvedValue({})
const getPullRequest = vi.fn()
const resolveThreadsForComments = vi.fn().mockResolvedValue([])
vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...args) => createIssueComment(...args),
  getPullRequest: (...args) => getPullRequest(...args),
  resolveThreadsForComments: (...args) => resolveThreadsForComments(...args),
}))

function withEnv(overrides, run) {
  const original = { ...process.env }
  Object.assign(process.env, overrides)
  return run().finally(() => {
    process.env = original
  })
}

describe('mark-fix-outcome', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
    resolveThreadsForComments.mockReset()
    resolveThreadsForComments.mockResolvedValue([])
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('posts the fix-dispatched marker when the step succeeded AND the head actually moved', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 906, head: { sha: 'abc1234' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'newsha0000' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('Completed automated fix round 1')
    expect(body).toContain('<!-- ops-codex-loop:stage=fix-dispatched pr=906 sha=abc1234 round=1 -->')
  })

  it('posts a visible failure warning and no marker when the outcome is not success', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 906, head: { sha: 'def5678' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'def5678' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '2',
        OUTCOME: 'failure',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('did not finish successfully')
    expect(body).not.toContain('ops-codex-loop:stage=fix-dispatched')
  })

  it('refuses to claim a push when the step went green but the head never moved', async () => {
    // Observed live on PR #931 (2026-08-12 04:19): claude-code-action exited
    // success having changed nothing (the findings were in .github/workflows,
    // which its own prompt forbids it to touch), and the loop announced
    // "pushed the change" anyway. A step's exit code is not evidence that a
    // commit exists. No marker either — a round that changed nothing must not
    // consume one of the three.
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 931, head: { sha: 'd3e9c50c' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'd3e9c50c' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('pushed no commit')
    expect(body).not.toContain('ops-codex-loop:stage=fix-dispatched')
  })

  it('resolves exactly the threads this round addressed, once a commit really landed', async () => {
    // Product Owner decision 2026-08-12 (option A). The repository ruleset
    // requires every review conversation resolved before a merge, so a PR that
    // took even one fix round could otherwise never auto-merge.
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 931, head: { sha: 'oldsha1111' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'newsha2222' } })
    resolveThreadsForComments.mockResolvedValue(['T_1', 'T_2'])

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
        RESOLVE_COMMENT_IDS: '[11,22]',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    expect(resolveThreadsForComments).toHaveBeenCalledTimes(1)
    expect(resolveThreadsForComments.mock.calls[0][4]).toEqual([11, 22])
    expect(createIssueComment.mock.calls[0][4]).toContain('Resolved 2 review thread(s)')
  })

  it('resolves nothing when the round pushed nothing', async () => {
    // Resolving a thread claims the finding was addressed. A round that
    // produced no commit addressed nothing, so closing the conversation would
    // be a plain false statement — and would hand the merge gate a clear path
    // over an unfixed finding.
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 931, head: { sha: 'samesha333' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'samesha333' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
        RESOLVE_COMMENT_IDS: '[11,22]',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    expect(resolveThreadsForComments).not.toHaveBeenCalled()
  })

  it('still reports the pushed fix when thread resolution itself fails', async () => {
    // The commit is on the branch either way; bookkeeping trouble must not be
    // reported as a failed fix round.
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 931, head: { sha: 'oldsha1111' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'newsha2222' } })
    resolveThreadsForComments.mockRejectedValue(new Error('GraphQL 502'))

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
        RESOLVE_COMMENT_IDS: '[11]',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    const body = createIssueComment.mock.calls[0][4] as string
    expect(body).toContain('Completed automated fix round 1')
    expect(body).toContain('Resolved 0 review thread(s)')
  })
})
