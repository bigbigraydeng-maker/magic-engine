import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isSampled } from '../src/sampling.mjs'

const createIssueComment = vi.fn().mockResolvedValue({})
const listIssueComments = vi.fn()
const listPullRequestFiles = vi.fn()
const listCheckRunsForRef = vi.fn()
const getPullRequest = vi.fn()
vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...args: unknown[]) => createIssueComment(...args),
  listIssueComments: (...args: unknown[]) => listIssueComments(...args),
  listPullRequestFiles: (...args: unknown[]) => listPullRequestFiles(...args),
  listCheckRunsForRef: (...args: unknown[]) => listCheckRunsForRef(...args),
  getPullRequest: (...args: unknown[]) => getPullRequest(...args),
}))

function withEnv(overrides: Record<string, string>, run: () => Promise<unknown>) {
  const original = { ...process.env }
  Object.assign(process.env, overrides)
  return run().finally(() => {
    process.env = original
  })
}

/** A sha (hex-shaped) that samples the given way for this PR number under the default 20% rate. */
function shaSampledAs(pr: number, wantSampled: boolean) {
  for (let i = 0; i < 10000; i++) {
    const sha = i.toString(16).padStart(40, '0')
    if (isSampled({ pr, sha }) === wantSampled) return sha
  }
  throw new Error('could not find a sha with the desired sampling outcome')
}

const OWNER_REPO = 'bigbigraydeng-maker/magic-engine'
const BASE = 'b'.repeat(40)

interface CheckRun {
  name: string
  status: string
  conclusion: string | null
}

const CI_NOT_GREEN_YET: CheckRun[] = []
// Both required CI and ops-fix-scope-guard terminal and passing — the shape
// the "CI already green" fallback needs to actually reach its verdict write.
// Codex finding (PR #1211, P2): a fixture with required CI alone used to be
// enough to exercise that write path, which is exactly the bug — production
// scores ops-fix-scope-guard's own check run too, and it races the required
// one on every push.
const CI_GREEN: CheckRun[] = [
  { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
  { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' },
]
const CI_GREEN_SCOPE_GUARD_PENDING: CheckRun[] = [
  { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
  { name: 'ops-fix-scope-guard', status: 'in_progress', conclusion: null },
]

function resetMocks() {
  createIssueComment.mockClear()
  listIssueComments.mockReset()
  listPullRequestFiles.mockReset()
  listCheckRunsForRef.mockReset()
  listCheckRunsForRef.mockResolvedValue(CI_NOT_GREEN_YET)
  getPullRequest.mockReset()
}

/** The common case: no concurrent push landed, so the PR's current head is still the event's own sha. */
function freshHead(sha: string) {
  getPullRequest.mockResolvedValue({ head: { sha } })
}

describe('request-review: rating', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-rate-'))
    resetMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('rates a docs-only PR C and posts the rating with a current gate marker', async () => {
    const pr = 1
    const sha = shaSampledAs(pr, false) // C, unsampled -> no @codex review either
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: 'docs only' } }),
    )
    listIssueComments.mockResolvedValue([])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    freshHead(sha)

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        REVIEW_REQUEST_TOKEN: 'pat',
        GITHUB_REPOSITORY: OWNER_REPO,
        GITHUB_EVENT_PATH: eventPath,
      },
      () => import('../src/request-review.mjs'),
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [token, , , , body] = createIssueComment.mock.calls[0]
    expect(token).toBe('tok')
    expect(body).toContain('PR 风险自动定级：C')
    expect(body).toContain(`"head":"${sha}"`)
  })

  it('rates an unreadable file list A and does not silently pass', async () => {
    const pr = 2
    const sha = shaSampledAs(pr, false)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    listIssueComments.mockResolvedValue([])
    listPullRequestFiles.mockRejectedValue(new Error('network error'))
    freshHead(sha)

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    const ratingCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('风险自动定级'))
    expect(ratingCall).toBeDefined()
    expect(ratingCall![4]).toContain('PR 风险自动定级：A')
  })

  it('does not re-post the rating when a trusted current gate marker already exists', async () => {
    const pr = 3
    const sha = shaSampledAs(pr, false)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    const existingMarker = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${sha}","risk":"B","reasons":[]} -->`
    listIssueComments.mockResolvedValue([{ user: { login: 'github-actions[bot]' }, body: existingMarker }])
    // Risk B always needs a Codex review, so step 2 below still writes one —
    // this must look like the current head, or the freshness check the
    // production code just gained would (correctly, but not what this test
    // is about) skip that write as stale.
    freshHead(sha)

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(listPullRequestFiles).not.toHaveBeenCalled()
    const ratingCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('风险自动定级'))
    expect(ratingCall).toBeUndefined()
  })

  it('ignores a gate marker written by an untrusted author (e.g. the PR author) and re-rates', async () => {
    const pr = 4
    const sha = shaSampledAs(pr, false)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    const forgedMarker = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${sha}","risk":"C","reasons":[]} -->`
    listIssueComments.mockResolvedValue([{ user: { login: 'some-pr-author' }, body: forgedMarker }])
    listPullRequestFiles.mockResolvedValue([{ filename: 'src/foo.ts', status: 'modified' }])
    freshHead(sha)

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(listPullRequestFiles).toHaveBeenCalled()
    const ratingCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('风险自动定级'))
    expect(ratingCall).toBeDefined()
  })
})

describe('request-review: Codex sampling', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-sample-'))
    resetMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('always requests review for an A-level PR', async () => {
    const pr = 10
    const sha = 'a'.repeat(40)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    listIssueComments.mockResolvedValue([])
    listPullRequestFiles.mockResolvedValue([{ filename: '.github/workflows/x.yml', status: 'modified' }])
    freshHead(sha)

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    const reviewCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('@codex review'))
    expect(reviewCall).toBeDefined()
    expect(reviewCall![0]).toBe('pat')
    // A always needs a review, so the CI-status short-circuit must never run.
    expect(listCheckRunsForRef).not.toHaveBeenCalled()
  })

  it('does not request review for a C-level PR outside the sample, and does not evaluate readiness while CI is still running', async () => {
    const pr = 20
    const sha = shaSampledAs(pr, false)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    listIssueComments.mockResolvedValue([])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    listCheckRunsForRef.mockResolvedValue(CI_NOT_GREEN_YET)
    freshHead(sha)

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    const reviewCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('@codex review'))
    expect(reviewCall).toBeUndefined()
    // Only the rating comment — no verdict yet, since CI has not gone green.
    expect(createIssueComment).toHaveBeenCalledTimes(1)
  })

  it('requests review for a C-level PR inside the sample', async () => {
    const pr = 21
    const sha = shaSampledAs(pr, true)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    listIssueComments.mockResolvedValue([])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    freshHead(sha)

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    const reviewCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('@codex review'))
    expect(reviewCall).toBeDefined()
  })

  it('does not re-request review when a review-requested marker already exists for this sha', async () => {
    const pr = 22
    const sha = 'a'.repeat(40)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    const dedupMarker = `<!-- ops-codex-loop:stage=review-requested pr=${pr} sha=${sha} -->`
    const gateMarker = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${sha}","risk":"A","reasons":[]} -->`
    listIssueComments.mockResolvedValue([{ user: { login: 'github-actions[bot]' }, body: `${gateMarker}\n${dedupMarker}` }])

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(createIssueComment).not.toHaveBeenCalled()
  })
})

describe('request-review: closes the race for unsampled C when CI is already green', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-race-'))
    resetMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('posts a readiness verdict directly when required CI already succeeded by rating time', async () => {
    const pr = 40
    const sha = shaSampledAs(pr, false)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    listIssueComments.mockResolvedValue([])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    listCheckRunsForRef.mockResolvedValue(CI_GREEN)
    freshHead(sha)

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    // Rating comment + verdict comment, no @codex review.
    expect(createIssueComment).toHaveBeenCalledTimes(2)
    const verdictCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('质量分'))
    expect(verdictCall).toBeDefined()
    const reviewCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('@codex review'))
    expect(reviewCall).toBeUndefined()
  })

  it('does not lock in a verdict when required CI is already green but ops-fix-scope-guard has not completed yet', async () => {
    // Codex finding (PR #1211, P2): ops-fix-scope-guard scores its own point
    // in the same verdict and races ai-orchestrator-ci.yml on the same
    // `pull_request` event. Required CI finishing first must not be enough
    // on its own to write a verdict — that used to silently lose the
    // scope-guard-green point and could post a wrongly-BLOCKED verdict that
    // then deduped forever.
    const pr = 43
    const sha = shaSampledAs(pr, false)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    listIssueComments.mockResolvedValue([])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    listCheckRunsForRef.mockResolvedValue(CI_GREEN_SCOPE_GUARD_PENDING)
    freshHead(sha)

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    // Only the rating comment — no verdict, and no @codex review (this PR is
    // unsampled C).
    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const verdictCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('质量分'))
    expect(verdictCall).toBeUndefined()
  })

  it('does not post a second verdict when one is already on record for this sha', async () => {
    const pr = 41
    const sha = shaSampledAs(pr, false)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    const decidedMarker = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${sha}","risk":"C","score":80,"decision":"READY_FOR_PRODUCT_OWNER"} -->`
    listIssueComments.mockResolvedValue([{ user: { login: 'github-actions[bot]' }, body: decidedMarker }])

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(listCheckRunsForRef).not.toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('does not re-post the rating or a second verdict when an older rating-only marker sits ahead of the decision marker in comment history', async () => {
    // Reproduces the exact shape a real PR's comment history has: the rating
    // (no `decision` field) is always posted before the quality verdict.
    // `.find()` picking the FIRST match — the rating — would make the
    // `decision` field permanently invisible to every later run, causing an
    // infinite re-rate/re-verdict loop. `findGateFor`'s last-match-wins must
    // surface the decision-bearing marker instead.
    const pr = 42
    const sha = shaSampledAs(pr, false)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    const ratingOnlyMarker = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${sha}","risk":"C","reasons":[]} -->`
    const decidedMarker = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${sha}","risk":"C","score":80,"decision":"READY_FOR_PRODUCT_OWNER"} -->`
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: ratingOnlyMarker },
      { user: { login: 'github-actions[bot]' }, body: decidedMarker },
    ])

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(listPullRequestFiles).not.toHaveBeenCalled()
    expect(listCheckRunsForRef).not.toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
  })
})

describe("request-review: fails closed when this event's head is no longer the PR's current head", () => {
  // Codex finding (PR #1211, P1): the concurrency group only serialises runs
  // for the SAME head sha. A run for an OLD sha delayed behind a NEW push can
  // call listPullRequestFiles/listCheckRunsForRef, which describe the PR's
  // CURRENT state, not the sha in this stale event — so it could rate or
  // verdict the old sha using the new diff. Re-checking the PR's actual
  // current head right before every write closes that.
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-stale-'))
    resetMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('does not read changed files or post a rating when the head already moved before this event could act', async () => {
    const pr = 50
    const sha = shaSampledAs(pr, false)
    const newerSha = 'f'.repeat(40)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    listIssueComments.mockResolvedValue([])
    getPullRequest.mockResolvedValue({ head: { sha: newerSha } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(listPullRequestFiles).not.toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('discards a rating computed from a diff that may no longer describe this sha, if the head moved while changed files were being read', async () => {
    const pr = 51
    const sha = shaSampledAs(pr, false)
    const newerSha = 'f'.repeat(40)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    listIssueComments.mockResolvedValue([])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    // Fresh at the pre-fetch check, moved by the time the post-fetch check runs.
    getPullRequest.mockResolvedValueOnce({ head: { sha } }).mockResolvedValueOnce({ head: { sha: newerSha } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(listPullRequestFiles).toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('does not post @codex review for a stale event, even when risk is already known from a trusted marker', async () => {
    const pr = 52
    const sha = 'a'.repeat(40) // risk A (via the trusted marker below) -> always needs a review
    const newerSha = 'f'.repeat(40)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    const existingMarker = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${sha}","risk":"A","reasons":[]} -->`
    listIssueComments.mockResolvedValue([{ user: { login: 'github-actions[bot]' }, body: existingMarker }])
    getPullRequest.mockResolvedValue({ head: { sha: newerSha } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(listPullRequestFiles).not.toHaveBeenCalled()
    const reviewCall = createIssueComment.mock.calls.find(([, , , , body]) => body.includes('@codex review'))
    expect(reviewCall).toBeUndefined()
  })

  it('does not post a CI-already-green verdict for a stale event', async () => {
    const pr = 53
    const sha = shaSampledAs(pr, false)
    const newerSha = 'f'.repeat(40)
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: pr, head: { sha }, base: { sha: BASE }, body: '' } }),
    )
    const existingMarker = `<!-- me-dev-gate:{"v":1,"base":"${BASE}","head":"${sha}","risk":"C","reasons":[]} -->`
    listIssueComments.mockResolvedValue([{ user: { login: 'github-actions[bot]' }, body: existingMarker }])
    listCheckRunsForRef.mockResolvedValue(CI_GREEN)
    getPullRequest.mockResolvedValue({ head: { sha: newerSha } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', REVIEW_REQUEST_TOKEN: 'pat', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/request-review.mjs'),
    )

    expect(createIssueComment).not.toHaveBeenCalled()
  })
})
