import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Behavioural cover for the merge job — the one place in this repository that
 * can put code on `main` with no human in the loop, and therefore deploy it.
 *
 * Written after a mutation run showed that removing its independent re-check of
 * the review verdict changed nothing: every assertion about this file was a
 * string match on the source, which cannot tell a live guard from a dead one.
 */

const createIssueComment = vi.fn().mockResolvedValue({})
const mergePullRequest = vi.fn().mockResolvedValue({})
const getPullRequest = vi.fn()
const listCheckRunsForRef = vi.fn()
const listReviewComments = vi.fn()

vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...a: unknown[]) => createIssueComment(...a),
  mergePullRequest: (...a: unknown[]) => mergePullRequest(...a),
  getPullRequest: (...a: unknown[]) => getPullRequest(...a),
  listCheckRunsForRef: (...a: unknown[]) => listCheckRunsForRef(...a),
  listReviewComments: (...a: unknown[]) => listReviewComments(...a),
}))

const SHA = 'e'.repeat(40)
const CLEAN = "Codex Review: Didn't find any major issues."
const green = [
  { name: 'ci', status: 'completed', conclusion: 'success', details_url: 'https://github.com/o/r/actions/runs/999/job/1' },
]

// process.exit(0) is how standDown ends. Turn it into a throwable so a test can
// assert "it stood down" instead of taking the whole runner down with it.
class Exited extends Error {}

function run(dir: string, env: Record<string, string>, reviewBody = CLEAN) {
  const eventPath = join(dir, 'event.json')
  writeFileSync(
    eventPath,
    JSON.stringify({ pull_request: { number: 931 }, review: { id: 7, body: reviewBody } }),
  )
  const original = { ...process.env }
  Object.assign(process.env, {
    GITHUB_TOKEN: 'tok',
    GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
    GITHUB_EVENT_PATH: eventPath,
    MERGE_SHA: SHA,
    AUTO_MERGE_ENABLED: 'true',
    GITHUB_RUN_ID: '31567460404',
    ...env,
  })
  return import('../src/merge-pr.mjs').finally(() => {
    process.env = original
  })
}

describe('merge-pr', () => {
  let dir: string
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-merge-'))
    createIssueComment.mockClear()
    mergePullRequest.mockClear()
    getPullRequest.mockReset().mockResolvedValue({
      state: 'open',
      draft: false,
      mergeable: true,
      base: { ref: 'main', repo: { full_name: 'bigbigraydeng-maker/magic-engine' } },
      head: { sha: SHA },
    })
    listCheckRunsForRef.mockReset().mockResolvedValue(green)
    listReviewComments.mockReset().mockResolvedValue([])
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Exited()
    }) as never)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  const standDownReason = () => String(createIssueComment.mock.calls[0]?.[4] ?? '')

  it('merges when every gate still holds at merge time', async () => {
    await run(dir, {})
    expect(mergePullRequest).toHaveBeenCalledTimes(1)
    expect(mergePullRequest.mock.calls[0][4]).toMatchObject({ sha: SHA })
  })

  it('stands down, and says so, when the kill switch was turned off after the gate', async () => {
    await expect(run(dir, { AUTO_MERGE_ENABLED: 'false' })).rejects.toBeInstanceOf(Exited)
    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(standDownReason()).toContain('OPS_AUTO_MERGE_ENABLED')
  })

  it('refuses when the triggering review carries actionable findings', async () => {
    // Defence in depth: the previous job is supposed to send only clean
    // reviews here, but that trust travelled through GITHUB_OUTPUT, which was
    // injectable. This job holds the write scope, so it re-derives the verdict
    // instead of believing the handoff.
    listReviewComments.mockResolvedValue([{ body: '**P1** still broken' }])
    await expect(run(dir, {})).rejects.toBeInstanceOf(Exited)
    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(standDownReason()).toContain('actionable')
  })

  it('refuses when the triggering review has no positive clean signal', async () => {
    await expect(run(dir, {}, 'some unrecognised text')).rejects.toBeInstanceOf(Exited)
    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(standDownReason()).toContain('clean signal')
  })

  it('refuses when the base was retargeted after the gate ran', async () => {
    getPullRequest.mockResolvedValue({
      state: 'open',
      draft: false,
      mergeable: true,
      base: { ref: 'release', repo: { full_name: 'bigbigraydeng-maker/magic-engine' } },
      head: { sha: SHA },
    })
    await expect(run(dir, {})).rejects.toBeInstanceOf(Exited)
    expect(mergePullRequest).not.toHaveBeenCalled()
    expect(standDownReason()).toContain('retargeted')
  })

  it('refuses when a check went red again without the sha moving', async () => {
    listCheckRunsForRef.mockResolvedValue([
      { ...green[0], conclusion: 'failure' },
    ])
    await expect(run(dir, {})).rejects.toBeInstanceOf(Exited)
    expect(mergePullRequest).not.toHaveBeenCalled()
  })

  it('ignores its own in-progress job when judging the checks', async () => {
    // Without the exclusion this job waits on itself and can never merge —
    // auto-merge would have stood down every single time.
    listCheckRunsForRef.mockResolvedValue([
      ...green,
      {
        name: 'merge',
        status: 'in_progress',
        conclusion: null,
        details_url: 'https://github.com/o/r/actions/runs/31567460404/job/2',
      },
    ])
    await run(dir, {})
    expect(mergePullRequest).toHaveBeenCalledTimes(1)
  })
})
