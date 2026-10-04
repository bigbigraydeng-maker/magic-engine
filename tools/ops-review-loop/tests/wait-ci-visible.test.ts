import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The `wait-ci` branch used to log and post nothing at all. This workflow only
 * listens to pull_request_review.submitted, so re-running a check to green
 * produces no new event — the PR just stopped moving, and from its page "CI is
 * red" and "the automation is broken" were the same picture: silence.
 */

const createIssueComment = vi.fn().mockResolvedValue({})
const listIssueComments = vi.fn().mockResolvedValue([])
const listReviewComments = vi.fn().mockResolvedValue([])
const listCheckRunsForRef = vi.fn()
const getPullRequest = vi.fn()

vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...a: unknown[]) => createIssueComment(...a),
  listIssueComments: (...a: unknown[]) => listIssueComments(...a),
  listReviewComments: (...a: unknown[]) => listReviewComments(...a),
  listCheckRunsForRef: (...a: unknown[]) => listCheckRunsForRef(...a),
  getPullRequest: (...a: unknown[]) => getPullRequest(...a),
}))

const SHA = 'c'.repeat(40)
const BASE = 'b'.repeat(40)

function run(dir: string) {
  const eventPath = join(dir, 'event.json')
  writeFileSync(
    eventPath,
    JSON.stringify({
      // handle-review.mjs (ME2-OPS03 PR2) reads pull_request.base.sha at
      // module load, for every plan.action branch — not just 'ready' — so
      // this fixture needs it even though the wait-ci path never scores risk.
      pull_request: { number: 931, head: { sha: SHA }, base: { sha: BASE }, body: '' },
      // commit_id must equal the event's own head sha — handle-review.mjs
      // (ME2-OPS03 PR2 Codex finding) fails closed at entry otherwise,
      // treating the review as already stale and skipping without writing
      // anything, which is why these fixtures need it even though none of
      // them are testing staleness itself.
      review: { id: 1, body: 'Codex Review: no findings worth flagging.', commit_id: SHA },
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
    OPS_POLL_ATTEMPTS: '2',
    OPS_POLL_INTERVAL_MS: '0',
  })
  return import('../src/handle-review.mjs').finally(() => {
    process.env = original
  })
}

describe('handle-review: CI never went green', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-waitci-'))
    createIssueComment.mockClear()
    listIssueComments.mockReset().mockResolvedValue([])
    listCheckRunsForRef.mockReset()
    // Default: the PR's head is still the reviewed commit when handle-review.mjs
    // re-checks freshness right before writing — see the isStale guard in
    // src/handle-review.mjs. Tests here are exercising the wait-ci report, not
    // staleness, so none of them override this.
    getPullRequest.mockReset().mockResolvedValue({ head: { sha: SHA } })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('says which check is not green instead of going silent', async () => {
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' },
    ])

    await run(dir)

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const body = String(createIssueComment.mock.calls[0][4])
    expect(body).toContain('BLOCKED ON CI')
    expect(body).toContain('ai-orchestrator-tests')
    expect(body).toContain('completed/failure')
    // And it must warn that re-running the check alone changes nothing, which
    // is the non-obvious part that left PRs stuck with no explanation.
    expect(body).toContain('will **not** move this PR on its own')
  })

  it('says so only once per commit', async () => {
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' },
    ])
    listIssueComments.mockResolvedValue([
      { body: `<!-- ops-codex-loop:stage=ci-blocked pr=931 sha=${SHA} -->` },
    ])

    await run(dir)

    expect(createIssueComment).not.toHaveBeenCalled()
  })
})

describe('handle-review: the BLOCKED ON CI report must use the gate\'s own standard', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-waitci2-'))
    createIssueComment.mockClear()
    listIssueComments.mockReset().mockResolvedValue([])
    listCheckRunsForRef.mockReset()
    // Default: the PR's head is still the reviewed commit when handle-review.mjs
    // re-checks freshness right before writing — see the isStale guard in
    // src/handle-review.mjs. Tests here are exercising the wait-ci report, not
    // staleness, so none of them override this.
    getPullRequest.mockReset().mockResolvedValue({ head: { sha: SHA } })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('shows a skipped required check instead of filtering it out as green', async () => {
    // Codex finding (PR #943, P2). The gate is completed+success, but this
    // listing used a looser rule that let `neutral`/`skipped` through — so a
    // required check ending `skipped` was dropped as "green" and the comment
    // said "no check runs reported at all", hiding the actual blocker.
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'skipped' },
    ])

    await run(dir)

    const body = String(createIssueComment.mock.calls[0][4])
    expect(body).toContain('ai-orchestrator-tests')
    expect(body).toContain('completed/skipped')
    expect(body).not.toContain('no check runs reported at all')
  })

  it('says plainly when the required check never reported, rather than blaming other failures', async () => {
    // Codex finding (PR #943, P2). Listing unrelated red checks reads as if
    // THOSE are the blocker; maintainers fix the wrong thing and the PR still
    // does not move. Absence is its own diagnosis.
    listCheckRunsForRef.mockResolvedValue([
      { name: 'Cloudflare Pages', status: 'completed', conclusion: 'failure' },
    ])

    await run(dir)

    const body = String(createIssueComment.mock.calls[0][4])
    expect(body).toContain('never appeared on this commit')
    // the unrelated failure is still listed, but clearly not as the blocker
    expect(body).toContain('Cloudflare Pages')
    expect(body).toContain('not the list below')
  })

  it('distinguishes a slow required check from an absent one', async () => {
    // Codex finding (PR #943, P2). A check that shows up late and is still
    // running when the poll gives up was being announced as "never appeared" —
    // a confident wrong diagnosis, worse than silence because it sends someone
    // to debug a workflow that is in fact working.
    listCheckRunsForRef
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ name: 'ai-orchestrator-tests', status: 'in_progress', conclusion: null }])

    await run(dir)

    const body = String(createIssueComment.mock.calls[0][4])
    expect(body).toContain('still `in_progress`')
    expect(body).not.toContain('never appeared')
    // and it tells the maintainer the thing that is not obvious: going green
    // on its own will not restart anything.
    expect(body).toContain('nothing will re-evaluate this PR')
  })
})

describe('handle-review: the report must not contradict itself', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-waitci3-'))
    createIssueComment.mockClear()
    listIssueComments.mockReset().mockResolvedValue([])
    listCheckRunsForRef.mockReset()
    // Default: the PR's head is still the reviewed commit when handle-review.mjs
    // re-checks freshness right before writing — see the isStale guard in
    // src/handle-review.mjs. Tests here are exercising the wait-ci report, not
    // staleness, so none of them override this.
    getPullRequest.mockReset().mockResolvedValue({ head: { sha: SHA } })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('lists a check once, in its latest state, not twice in two states', async () => {
    // Codex finding (PR #943, P2). The pre-poll snapshot and the polled result
    // are different objects for the same check, so a reference-based dedupe
    // (`r !== requiredCheck`) never matched and the comment listed the check
    // twice — `in_progress` from four minutes ago next to `completed/failure`
    // from now. A report that contradicts itself is worse than a terse one.
    const early = { id: 11, name: 'ai-orchestrator-tests', status: 'in_progress', conclusion: null }
    const late = { id: 11, name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' }
    listCheckRunsForRef.mockResolvedValueOnce([early]).mockResolvedValue([late])

    await run(dir)

    const body = String(createIssueComment.mock.calls[0][4])
    // Count list entries, not every mention: the blocker sentence names the
    // required check too, and that is deliberate.
    const listEntries = body.match(/^- `ai-orchestrator-tests`/gm) ?? []
    expect(listEntries.length).toBe(1)
    expect(body).toContain('completed/failure')
    // The stale `in_progress` observation must not survive anywhere.
    expect(body).not.toContain('in_progress')
  })

  it('reports the other checks as they are now, not as they were before polling', async () => {
    const stale = { id: 22, name: 'build', status: 'in_progress', conclusion: null }
    const fresh = { id: 22, name: 'build', status: 'completed', conclusion: 'failure' }
    listCheckRunsForRef
      .mockResolvedValueOnce([stale])
      .mockResolvedValue([fresh, { id: 11, name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' }])

    await run(dir)

    const body = String(createIssueComment.mock.calls[0][4])
    expect(body).toContain('`build` — completed/failure')
    expect(body).not.toContain('`build` — in_progress')
  })
})
