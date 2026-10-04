import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isSampled } from '../src/sampling.mjs'

const getPullRequest = vi.fn()
const listIssueComments = vi.fn()
const listCheckRunsForRef = vi.fn()
const listPullRequestFiles = vi.fn()
const createIssueComment = vi.fn().mockResolvedValue({})
vi.mock('../src/github.mjs', () => ({
  getPullRequest: (...args: unknown[]) => getPullRequest(...args),
  listIssueComments: (...args: unknown[]) => listIssueComments(...args),
  listCheckRunsForRef: (...args: unknown[]) => listCheckRunsForRef(...args),
  listPullRequestFiles: (...args: unknown[]) => listPullRequestFiles(...args),
  createIssueComment: (...args: unknown[]) => createIssueComment(...args),
}))

function withEnv(overrides: Record<string, string>, run: () => Promise<unknown>) {
  const original = { ...process.env }
  Object.assign(process.env, overrides)
  return run().finally(() => {
    process.env = original
  })
}

function shaSampledAs(pr: number, wantSampled: boolean) {
  for (let i = 0; i < 10000; i++) {
    const sha = i.toString(16).padStart(40, '0')
    if (isSampled({ pr, sha }) === wantSampled) return sha
  }
  throw new Error('could not find a sha with the desired sampling outcome')
}

const OWNER_REPO = 'bigbigraydeng-maker/magic-engine'
const BASE = 'b'.repeat(40)

function eventFile(dir: string, workflowRun: Record<string, unknown>) {
  const eventPath = join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify({ workflow_run: workflowRun }))
  return eventPath
}

function gateMarker({
  base = BASE,
  head,
  risk,
  score,
  decision,
}: {
  base?: string
  head: string
  risk: string
  score?: number
  decision?: string
}) {
  const payload: { v: number; base: string; head: string; risk: string; score?: number; decision?: string } = {
    v: 1,
    base,
    head,
    risk,
  }
  if (score !== undefined) payload.score = score
  if (decision !== undefined) payload.decision = decision
  return `<!-- me-dev-gate:${JSON.stringify(payload)} -->`
}

interface PrFixture {
  number: number
  base: { ref: string; sha: string }
  head: { ref: string; sha: string; repo: { full_name: string } }
  state: string
  body: string
}

const openPr = (overrides: Partial<PrFixture> = {}): PrFixture => ({
  number: 5,
  base: { ref: 'main', sha: BASE },
  head: { ref: 'claude/issue-5', sha: 'c'.repeat(40), repo: { full_name: OWNER_REPO } },
  state: 'open',
  body: '',
  ...overrides,
})

describe('recheck-readiness', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-recheck-'))
    getPullRequest.mockReset()
    listIssueComments.mockReset()
    listCheckRunsForRef.mockReset()
    listPullRequestFiles.mockReset()
    createIssueComment.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('does nothing when the completed check is not the required one', async () => {
    const eventPath = eventFile(dir, {
      name: 'some-other-check',
      status: 'completed',
      pull_requests: [{ number: 5 }],
    })
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(getPullRequest).not.toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('does nothing when the required check has not completed yet', async () => {
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'in_progress',
      pull_requests: [{ number: 5 }],
    })
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(getPullRequest).not.toHaveBeenCalled()
  })

  it('does nothing when the PR does not qualify (wrong base branch)', async () => {
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 5 }],
    })
    getPullRequest.mockResolvedValue(openPr({ base: { ref: 'staging', sha: BASE } }))
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('skips when there is no current trusted risk rating yet', async () => {
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 5 }],
    })
    getPullRequest.mockResolvedValue(openPr())
    listIssueComments.mockResolvedValue([])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('skips when a readiness decision is already on record for this head (dedup)', async () => {
    const pr = openPr()
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 5 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      {
        user: { login: 'github-actions[bot]' },
        body: gateMarker({ head: pr.head.sha, risk: 'C', score: 90, decision: 'READY_FOR_PRODUCT_OWNER' }),
      },
    ])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('skips (dedup) when an older rating-only marker sits ahead of the decision marker in comment history', async () => {
    // Same shape a real PR always has: the rating (no `decision`) posts
    // before the quality verdict. `.find()` picking the FIRST match would
    // make the decision permanently invisible and re-post a verdict forever.
    const pr = openPr()
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 5 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
      {
        user: { login: 'github-actions[bot]' },
        body: gateMarker({ head: pr.head.sha, risk: 'C', score: 90, decision: 'READY_FOR_PRODUCT_OWNER' }),
      },
    ])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(listCheckRunsForRef).not.toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('backs off an A-level PR — that belongs to the review-triggered leg', async () => {
    const pr = openPr()
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 5 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'A' }) },
    ])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).not.toHaveBeenCalled()
    expect(listCheckRunsForRef).not.toHaveBeenCalled()
  })

  it('backs off a C-level PR that the stable sample selected for Codex review', async () => {
    const pr = openPr({ number: 30, head: { ref: 'claude/issue-30', sha: shaSampledAs(30, true), repo: { full_name: OWNER_REPO } } })
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 30 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('waits (posts nothing) when the required check has not completed yet, even though the workflow_run itself has', async () => {
    // The workflow_run event that triggers this leg can arrive before the
    // required CHECK RUN it cares about (a different GitHub object,
    // eventually consistent against the check-runs API) has finished
    // reporting. That is the one case still worth waiting on — a later
    // workflow_run for the same required workflow can still arrive.
    const pr = openPr({ number: 31, head: { ref: 'claude/issue-31', sha: shaSampledAs(31, false), repo: { full_name: OWNER_REPO } } })
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 31 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    listCheckRunsForRef.mockResolvedValue([{ name: 'ai-orchestrator-tests', status: 'in_progress', conclusion: null }])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('posts BLOCKED for an unsampled C-level PR whose required check completed with a failing conclusion', async () => {
    // Codex finding (PR #1211, P1): this leg only fires once, on the required
    // workflow's own completion event. A required check that finished
    // `failure`/`cancelled`/`timed_out` is just as terminal as one that
    // succeeded — there is no future workflow_run coming to re-evaluate it.
    // The old behaviour returned silently here, leaving the PR with no
    // READY/BLOCKED marker forever. It must instead flow into the same
    // quality gate as a passing run and come out BLOCKED.
    const pr = openPr({ number: 31, head: { ref: 'claude/issue-31', sha: shaSampledAs(31, false), repo: { full_name: OWNER_REPO } } })
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'failure',
      pull_requests: [{ number: 31 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    // The scope guard is also terminal here — this test is about the
    // required check's own failing conclusion still producing BLOCKED, not
    // about the scope-guard-pending race (see the dedicated tests below).
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' },
      { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' },
    ])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('BLOCKED')
  })

  it('posts BLOCKED when the required check completed as cancelled, not just failure', async () => {
    const pr = openPr({ number: 34, head: { ref: 'claude/issue-34', sha: shaSampledAs(34, false), repo: { full_name: OWNER_REPO } } })
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'cancelled',
      pull_requests: [{ number: 34 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'cancelled' },
      { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' },
    ])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('BLOCKED')
  })

  it('posts a verdict for an unsampled C-level PR once required CI is green', async () => {
    const pr = openPr({
      number: 32,
      head: { ref: 'claude/issue-32', sha: shaSampledAs(32, false), repo: { full_name: OWNER_REPO } },
      body: 'plain PR body with no evidence sections',
    })
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 32 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
      { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' },
    ])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    // A near-empty body has almost no observed signals, so the score sits well
    // under C's 75 threshold — BLOCKED is the correct, evidence-driven verdict,
    // not READY by default.
    expect(body).toContain('BLOCKED')
    expect(body).toContain('质量分')
  })

  it('waits (posts nothing) when required CI is green but ops-fix-scope-guard has not completed yet', async () => {
    // Codex finding (PR #1211, P2): ops-fix-scope-guard scores its own point
    // in the same verdict and races ai-orchestrator-ci.yml on every push.
    // Whichever finishes first must NOT be enough on its own to write a
    // verdict — a required-CI-only wait let a BLOCKED lock in for a PR whose
    // scope guard simply hadn't reported yet.
    const pr = openPr({ number: 35, head: { ref: 'claude/issue-35', sha: shaSampledAs(35, false), repo: { full_name: OWNER_REPO } } })
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 35 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
      { name: 'ops-fix-scope-guard', status: 'in_progress', conclusion: null },
    ])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('waits (posts nothing) when ops-fix-scope-guard is green but required CI has not completed yet, even though THIS event is the scope guard finishing', async () => {
    // Symmetric case: this run was triggered by ops-fix-scope-guard's own
    // workflow_run completing (not ai-orchestrator CI's), but the required
    // check itself is still running. Waiting on the OTHER check is exactly
    // as necessary regardless of which workflow's completion triggered this
    // particular run.
    const pr = openPr({ number: 36, head: { ref: 'claude/issue-36', sha: shaSampledAs(36, false), repo: { full_name: OWNER_REPO } } })
    const eventPath = eventFile(dir, {
      name: 'OPS — Auto-fix blast radius guard',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 36 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'in_progress', conclusion: null },
      { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' },
    ])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('posts exactly one verdict when ops-fix-scope-guard finishes SECOND, triggered by its own workflow_run', async () => {
    // Event order: ai-orchestrator CI already went green earlier (this leg
    // backed off with the "waits" behaviour above, posting nothing). Now
    // ops-fix-scope-guard finishes too, and ITS workflow_run is what fires
    // this run — required CI is already terminal from before, so both are
    // terminal now and exactly one verdict comes out.
    const richBody = [
      'Closes #1210',
      '验收条件：全部通过',
      '明确不做：不动 kernel',
      '## Reuse Statement 复用声明',
      '失败处理：fail-closed',
      '观测：失败会被谁发现 —— cron 日志',
      'npm run build 通过',
      'npx vitest run tools/ops-review-loop 全绿',
    ].join('\n\n')
    const pr = openPr({
      number: 37,
      head: { ref: 'claude/issue-37', sha: shaSampledAs(37, false), repo: { full_name: OWNER_REPO } },
      body: richBody,
    })
    const eventPath = eventFile(dir, {
      name: 'OPS — Auto-fix blast radius guard',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 37 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
      { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' },
    ])
    listPullRequestFiles.mockResolvedValue([
      { filename: 'docs/x.md', status: 'modified' },
      { filename: 'scripts/example.test.ts', status: 'added' },
    ])

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('READY FOR PRODUCT OWNER')
  })

  it('does not post a second verdict when ops-fix-scope-guard\'s workflow_run arrives after a decision is already on record', async () => {
    // Duplicate-event case: the decision marker already exists (e.g. posted
    // by the ai-orchestrator-CI-triggered run), and a later, redundant
    // workflow_run for ops-fix-scope-guard (a re-run, or simply arriving
    // after the fact) must not write a second verdict.
    const pr = openPr({ number: 38, head: { ref: 'claude/issue-38', sha: shaSampledAs(38, false), repo: { full_name: OWNER_REPO } } })
    const eventPath = eventFile(dir, {
      name: 'OPS — Auto-fix blast radius guard',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 38 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      {
        user: { login: 'github-actions[bot]' },
        body: gateMarker({ head: pr.head.sha, risk: 'C', score: 90, decision: 'READY_FOR_PRODUCT_OWNER' }),
      },
    ])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(listCheckRunsForRef).not.toHaveBeenCalled()
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('reaches READY when the PR body and diff carry every observed signal', async () => {
    const richBody = [
      'Closes #1210',
      '验收条件：全部通过',
      '明确不做：不动 kernel',
      '## Reuse Statement 复用声明',
      '失败处理：fail-closed',
      '观测：失败会被谁发现 —— cron 日志',
      'npm run build 通过',
      'npx vitest run tools/ops-review-loop 全绿',
    ].join('\n\n')
    const pr = openPr({
      number: 33,
      head: { ref: 'claude/issue-33', sha: shaSampledAs(33, false), repo: { full_name: OWNER_REPO } },
      body: richBody,
    })
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 33 }],
    })
    getPullRequest.mockResolvedValue(pr)
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: pr.head.sha, risk: 'C' }) },
    ])
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
      { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' },
    ])
    listPullRequestFiles.mockResolvedValue([
      { filename: 'docs/x.md', status: 'modified' },
      { filename: 'scripts/example.test.ts', status: 'added' },
    ])

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('READY FOR PRODUCT OWNER')
  })

  it('evaluates every PR listed on the check run, independently', async () => {
    const eventPath = eventFile(dir, {
      name: 'ai-orchestrator CI',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 40 }, { number: 41 }],
    })
    getPullRequest.mockImplementation((_t: unknown, _o: unknown, _r: unknown, n: number) =>
      Promise.resolve(openPr({ number: n, head: { ref: `claude/issue-${n}`, sha: `${n}`.padStart(40, '0'), repo: { full_name: OWNER_REPO } } })),
    )
    listIssueComments.mockResolvedValue([])
    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath },
      () => import('../src/recheck-readiness.mjs'),
    )
    expect(getPullRequest).toHaveBeenCalledTimes(2)
  })
})
