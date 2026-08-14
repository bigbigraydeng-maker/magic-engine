import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const createIssueComment = vi.fn().mockResolvedValue({})
const getPullRequest = vi.fn()
vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...args) => createIssueComment(...args),
  getPullRequest: (...args) => getPullRequest(...args),
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
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('posts the fix-dispatched marker when the step succeeded AND the head actually moved', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 906, head: { sha: 'abc1234' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'newsha7777' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
        HEAD_BEFORE: 'a'.repeat(40),
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
})

describe('mark-fix-outcome: a round that pushed nothing', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-nopush-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('refuses to claim a push when the step went green but the head never moved', async () => {
    // Observed three times on PR #931 (2026-08-12 04:19, 04:41, 04:51):
    // claude-code-action exited success having changed nothing — the findings
    // were in .github/workflows, which its own prompt forbids it to touch —
    // and the loop announced "pushed the change" each time. Every commit on
    // that branch was in fact hand-pushed.
    //
    // Worse, those three phantom rounds consumed the whole 3-round budget, so
    // the loop then declared NEEDS HUMAN REVIEW about work it never attempted.
    // Hence: no marker either.
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
    expect(body).toContain('not** counted against the 3-round limit')
    expect(body).not.toContain('ops-codex-loop:stage=fix-dispatched')
  })

  it('names the real new head when it did push', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 931, head: { sha: 'oldsha0000' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'brandnew11' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
        HEAD_BEFORE: 'b'.repeat(40),
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('brandnew11')
    expect(body).toContain('stage=fix-dispatched')
  })
})

describe('mark-fix-outcome: the baseline must bracket this round', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-baseline-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
    delete process.env.HEAD_BEFORE
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.HEAD_BEFORE
    vi.resetModules()
  })

  const SHA_BEFORE = 'c'.repeat(40)

  it('does not claim a push when someone else moved the head after the review landed', async () => {
    // Codex finding (PR #943, P2). The review event's sha can be minutes old.
    // Comparing against it means a commit pushed by a human, another
    // automation, or a second window on the same branch reads as "Claude fixed
    // it" — claimed in a comment and charged against the 3-round budget.
    //
    // Here the review event is stale (its sha is long gone) but the head has
    // NOT moved since this round started, so nothing was pushed by this round.
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 943, head: { sha: 'staleevent' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: SHA_BEFORE } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
        HEAD_BEFORE: SHA_BEFORE,
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('pushed no commit')
    expect(body).not.toContain('ops-codex-loop:stage=fix-dispatched')
    // Codex finding (PR #943, P2): the message must name the head it actually
    // read, not the sha from the (stale) review event. Fixing the accounting
    // while still printing commit A swaps one false statement for another.
    expect(body).toContain(SHA_BEFORE.slice(0, 10))
    expect(body).not.toContain('staleevent')
  })

  it('reports no push when the baseline is missing, rather than guessing', async () => {
    // If the baseline step was skipped or a future edit drops the env var, the
    // safe reading is "nothing was pushed". Over-reporting is the exact failure
    // this file exists to stop.
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 943, head: { sha: 'whatever00' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'movedalot1' } })

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

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('pushed no commit')
  })
})

describe('mark-fix-outcome: pushed a commit and then failed', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-pushfail-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('counts the round, because the commit is real', async () => {
    // Codex finding (PR #943, P2). If the action pushes and only then fails,
    // the old shape fell into the failure branch, announced "no change was
    // pushed" without checking, and wrote no marker. The commits are real and
    // trigger further reviews, so the 3-round cap could be blown while the
    // loop insisted nothing had happened.
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 943, head: { sha: 'oldhead000' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'pushedhead' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '2',
        OUTCOME: 'failure',
        HEAD_BEFORE: 'd'.repeat(40),
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('pushedhead')
    expect(body).toContain('stage=fix-dispatched')
    expect(body).toContain('this round **is** counted')
    // and it must not claim the run was clean
    expect(body).toContain('failure')
  })

  it('only claims "no commit was pushed" when it verified that', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 943, head: { sha: 'samehead00' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'e'.repeat(40) } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '2',
        OUTCOME: 'failure',
        HEAD_BEFORE: 'e'.repeat(40),
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('no commit was pushed')
    expect(body).toContain('eeeeeeeeee')
    expect(body).not.toContain('stage=fix-dispatched')
  })
})
