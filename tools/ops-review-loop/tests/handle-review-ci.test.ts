import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Behavioural cover for the CI-wait path in handle-review.mjs.
 *
 * Added because a mutation run (2026-08-12) reverted the fix for Codex's PR
 * #931 P2 — waiting for "every check settled" instead of "every check green" —
 * and all 100 tests still passed. The fix was real and its coverage was zero,
 * which is the failure mode where a gate exists in the source and nothing
 * would ever notice it being removed.
 */

const createIssueComment = vi.fn().mockResolvedValue({})
const listIssueComments = vi.fn().mockResolvedValue([])
const listReviewComments = vi.fn().mockResolvedValue([])
const listCheckRunsForRef = vi.fn()
const getPullRequest = vi.fn().mockResolvedValue({ draft: false, mergeable: true, head: { sha: 'x' } })

vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...a: unknown[]) => createIssueComment(...a),
  listIssueComments: (...a: unknown[]) => listIssueComments(...a),
  listReviewComments: (...a: unknown[]) => listReviewComments(...a),
  listCheckRunsForRef: (...a: unknown[]) => listCheckRunsForRef(...a),
  getPullRequest: (...a: unknown[]) => getPullRequest(...a),
  mergePullRequest: vi.fn(),
}))

const SHA = 'c'.repeat(40)

function run(dir: string) {
  const eventPath = join(dir, 'event.json')
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: { number: 931, head: { sha: SHA }, draft: false },
      review: { id: 1, body: "Codex Review: Didn't find any major issues.", commit_id: SHA },
    }),
  )
  const outPath = join(dir, 'out.txt')
  writeFileSync(outPath, '')
  const original = { ...process.env }
  Object.assign(process.env, {
    GITHUB_TOKEN: 'tok',
    GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: outPath,
    AUTO_MERGE_ENABLED: 'true',
    OPS_POLL_ATTEMPTS: '2',
    OPS_POLL_INTERVAL_MS: '0',
  })
  return import('../src/handle-review.mjs').finally(() => {
    process.env = original
  })
}

describe('handle-review: a check that already failed', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-ci-'))
    createIssueComment.mockClear()
    listCheckRunsForRef.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('does not auto-merge, and says out loud which check is red', async () => {
    // The regression: `settled` was satisfied immediately by an
    // already-failed check, so the run fell through to wait-ci — which used to
    // post nothing. Nothing re-triggers this workflow for the same sha, so the
    // PR sat silent and unmergeable with no trace of why.
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
      { name: 'build', status: 'completed', conclusion: 'failure' },
    ])

    await run(dir)

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const body = createIssueComment.mock.calls[0][4] as string
    expect(body).toContain('BLOCKED ON CI')
    expect(body).toContain('build')
    expect(body).not.toContain('AUTO-MERGED')
    expect(body).not.toContain('READY FOR PRODUCT OWNER')
  })

  it('auto-merges when every check is green and the review is for this exact commit', async () => {
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
      { name: 'build', status: 'completed', conclusion: 'success' },
    ])

    await run(dir)

    // The merge itself now happens in the isolated merge job, so this path
    // posts nothing and only emits the decision.
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('keeps polling a red check and picks it up when a re-run turns it green', async () => {
    // THE difference between waiting for "settled" and waiting for "green".
    // Both produce the same comment when CI stays red, which is why the first
    // version of this file passed against either implementation and locked
    // nothing. Only this case separates them: under "settled" the already-
    // failed check ends the wait on the first look and the re-run is never
    // seen; under "green" the poll keeps going and finds it.
    listCheckRunsForRef
      .mockResolvedValueOnce([
        { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
        { name: 'build', status: 'completed', conclusion: 'failure' },
      ])
      .mockResolvedValue([
        { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
        { name: 'build', status: 'completed', conclusion: 'success' },
      ])

    await run(dir)

    // Green on the retry: no BLOCKED comment at all, and the decision goes to
    // the isolated merge job (which posts nothing from here).
    expect(createIssueComment).not.toHaveBeenCalled()
  })
})
