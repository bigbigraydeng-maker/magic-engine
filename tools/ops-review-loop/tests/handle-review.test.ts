import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOutputs } from '../src/output.mjs'

const createIssueComment = vi.fn().mockResolvedValue({})
const getPullRequest = vi.fn()
const listCheckRunsForRef = vi.fn()
const listIssueComments = vi.fn()
const listPullRequestFiles = vi.fn()
const listReviewComments = vi.fn()
vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...args: unknown[]) => createIssueComment(...args),
  getPullRequest: (...args: unknown[]) => getPullRequest(...args),
  listCheckRunsForRef: (...args: unknown[]) => listCheckRunsForRef(...args),
  listIssueComments: (...args: unknown[]) => listIssueComments(...args),
  listPullRequestFiles: (...args: unknown[]) => listPullRequestFiles(...args),
  listReviewComments: (...args: unknown[]) => listReviewComments(...args),
}))

function withEnv(overrides: Record<string, string>, run: () => Promise<unknown>) {
  const original = { ...process.env }
  Object.assign(process.env, overrides)
  return run().finally(() => {
    process.env = original
  })
}

const OWNER_REPO = 'bigbigraydeng-maker/magic-engine'
const BASE = 'b'.repeat(40)
const SHA = 'c'.repeat(40)
// Distinct historical SHAs for round-budget markers: fix-dispatched rounds are
// counted across all SHAs on the PR (see plan.mjs), not scoped to the current
// head, so these must be valid 7-40 hex chars per markers.mjs's MARKER_RE but
// different from SHA/BASE and from each other.
const OLD_SHA_1 = 'd'.repeat(40)
const OLD_SHA_2 = 'e'.repeat(40)
const GREEN_CI = { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' }

function gateMarker({ head, risk }: { head: string; risk: string }) {
  return `<!-- me-dev-gate:${JSON.stringify({ v: 1, base: BASE, head, risk })} -->`
}

// `commitId` defaults to SHA (the same value `pull_request.head.sha` carries)
// so every existing fixture reads as "the review describes the PR's current
// head" — the fail-closed entry check in handle-review.mjs requires exactly
// that match before it does anything else. Tests exercising a stale or
// malformed review pass a different `commitId` (or `null`) explicitly.
function eventFile(
  dir: string,
  {
    body = 'clean review',
    commitId = SHA,
    headSha = SHA,
  }: { body?: string; commitId?: string | null; headSha?: string } = {},
) {
  const eventPath = join(dir, 'event.json')
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: { number: 7, head: { sha: headSha }, base: { sha: BASE }, body: 'PR body' },
      review: { id: 99, body, commit_id: commitId },
    }),
  )
  return eventPath
}

// setOutput() (src/output.mjs) appends to $GITHUB_OUTPUT unconditionally —
// every plan.action branch in handle-review.mjs calls it. A real GITHUB_OUTPUT
// path is required or appendFileSync(undefined, ...) throws before any
// assertion runs. Same pattern as wait-ci-visible.test.ts's outPath.
function outputFile(dir: string) {
  const outPath = join(dir, 'out.txt')
  writeFileSync(outPath, '')
  return outPath
}

function readAction(outPath: string) {
  return parseOutputs(readFileSync(outPath, 'utf8')).action
}

describe('handle-review: round budget follows risk', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-hr-round-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
    listCheckRunsForRef.mockReset()
    listIssueComments.mockReset()
    listPullRequestFiles.mockReset()
    listReviewComments.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('caps an A-level PR at 2 rounds, not the old flat 3', async () => {
    const eventPath = eventFile(dir, { body: 'P1 fix this' })
    // Two prior fix-dispatched rounds already on record for this PR (any sha) —
    // the third actionable review should hit the A-level cap of 2.
    const priorRounds = [OLD_SHA_1, OLD_SHA_2]
      .map((sha, index) => `<!-- ops-codex-loop:stage=fix-dispatched pr=7 sha=${sha} round=${index + 1} -->`)
      .join('\n')
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: `${gateMarker({ head: SHA, risk: 'A' })}\n${priorRounds}` },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    getPullRequest.mockResolvedValue({ head: { sha: SHA } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('NEEDS HUMAN REVIEW')
    expect(body).toContain('risk level A')
  })

  it('caps a C-level (or unrated) PR at 1 round', async () => {
    const eventPath = eventFile(dir, { body: 'P1 fix this' })
    const priorRound = `<!-- ops-codex-loop:stage=fix-dispatched pr=7 sha=${OLD_SHA_1} round=1 -->`
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: `${gateMarker({ head: SHA, risk: 'C' })}\n${priorRound}` },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    getPullRequest.mockResolvedValue({ head: { sha: SHA } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('NEEDS HUMAN REVIEW')
  })

  it('gives an unrated PR the smallest budget, not the largest', async () => {
    const eventPath = eventFile(dir, { body: 'P1 fix this' })
    const priorRound = `<!-- ops-codex-loop:stage=fix-dispatched pr=7 sha=${OLD_SHA_1} round=1 -->`
    // No trusted gate marker at all this time.
    listIssueComments.mockResolvedValue([{ user: { login: 'github-actions[bot]' }, body: priorRound }])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    getPullRequest.mockResolvedValue({ head: { sha: SHA } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('NEEDS HUMAN REVIEW')
    expect(body).toContain('risk level unknown')
  })
})

describe('handle-review: the ready case runs the real quality gate', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-hr-ready-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
    listCheckRunsForRef.mockReset()
    listIssueComments.mockReset()
    listPullRequestFiles.mockReset()
    listReviewComments.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('posts BLOCKED, not an unconditional READY, when the PR carries no evidence', async () => {
    const eventPath = eventFile(dir, { body: 'Clean review — nothing to flag.' })
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: SHA, risk: 'C' }) },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    getPullRequest.mockResolvedValue({ head: { sha: SHA } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('BLOCKED')
    expect(body).not.toContain('READY FOR PRODUCT OWNER')
    // The ops-codex-loop dedup marker must still be present, or a later
    // duplicate review event would re-evaluate and re-post this forever.
    expect(body).toContain('ops-codex-loop:stage=ready')
  })

  it('posts READY when required CI is green and no actionable findings exist, with real evidence present', async () => {
    const richBody = [
      'Closes #1210',
      '验收条件：全部通过',
      '明确不做：不动 kernel',
      '## Reuse Statement',
      '失败处理：fail-closed',
      '观测：失败会被谁发现',
      'npm run build 通过',
      'npx vitest run tools/ops-review-loop 全绿',
    ].join('\n\n')
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: { number: 7, head: { sha: SHA }, base: { sha: BASE }, body: richBody },
        review: { id: 99, body: 'Clean review — nothing to flag.', commit_id: SHA },
      }),
    )
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: SHA, risk: 'C' }) },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI, { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' }])
    listPullRequestFiles.mockResolvedValue([
      { filename: 'docs/x.md', status: 'modified' },
      { filename: 'scripts/example.test.ts', status: 'added' },
    ])
    getPullRequest.mockResolvedValue({ head: { sha: SHA } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('READY FOR PRODUCT OWNER')
  })
})

describe('handle-review: fails closed when the reviewed commit is not the current head', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-hr-stale-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
    listCheckRunsForRef.mockReset()
    listIssueComments.mockReset()
    listPullRequestFiles.mockReset()
    listReviewComments.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it("skips with no reads at all when review.commit_id does not match the event's own head sha (old review, new event head)", async () => {
    // Codex's review describes an older commit; by the time GitHub delivered
    // pull_request_review.submitted, the PR's head had already moved on —
    // the event payload's own pull_request.head.sha proves it. This must be
    // caught before any I/O, not just before the final write.
    const eventPath = eventFile(dir, { body: 'P1 fix this', commitId: OLD_SHA_1, headSha: SHA })
    const outPath = outputFile(dir)

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outPath },
      () => import('../src/handle-review.mjs'),
    )

    expect(listIssueComments).not.toHaveBeenCalled()
    expect(getPullRequest).not.toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
    expect(readAction(outPath)).toBe('skip')
  })

  it('skips without any writes when review.commit_id is missing or not a string', async () => {
    const eventPath = eventFile(dir, { body: 'P1 fix this', commitId: null })
    const outPath = outputFile(dir)

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outPath },
      () => import('../src/handle-review.mjs'),
    )

    expect(listIssueComments).not.toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
    expect(readAction(outPath)).toBe('skip')
  })

  it('skips a clean-review verdict without writing when the head moved past the reviewed commit before this run could conclude', async () => {
    // Simulates a push landing after Codex reviewed SHA but before this run
    // reached its conclusion (e.g. during the required-CI poll) —
    // getPullRequest now reports a head newer than what was reviewed.
    const eventPath = eventFile(dir, { body: 'Clean review — nothing to flag.' })
    const outPath = outputFile(dir)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: SHA, risk: 'C' }) },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    getPullRequest.mockResolvedValue({ head: { sha: 'f'.repeat(40) } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outPath },
      () => import('../src/handle-review.mjs'),
    )

    expect(createIssueComment).not.toHaveBeenCalled()
    expect(readAction(outPath)).toBe('skip')
  })

  it('skips a dispatch without consuming a round when the head moved past the reviewed commit', async () => {
    const eventPath = eventFile(dir, { body: 'P1 fix this' })
    const outPath = outputFile(dir)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: SHA, risk: 'A' }) },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    getPullRequest.mockResolvedValue({ head: { sha: 'f'.repeat(40) } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outPath },
      () => import('../src/handle-review.mjs'),
    )

    expect(createIssueComment).not.toHaveBeenCalled()
    expect(readAction(outPath)).toBe('skip')
  })
})
