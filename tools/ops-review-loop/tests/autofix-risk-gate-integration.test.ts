/**
 * Integration tests for the A-level risk gate in handle-review.mjs.
 *
 * Unlike autofix-risk-gate.test.ts (which tests classifyRisk and readDeclaredRisk
 * as pure functions), these tests import handle-review.mjs — the actual entrypoint
 * script — and verify the dispatch-fix path end-to-end:
 *
 *   event + mocks → handle-review.mjs → outputs + comments
 *
 * Pattern follows wait-ci-visible.test.ts: mock github.mjs, write an event file,
 * set env vars, dynamically import the entrypoint, read $GITHUB_OUTPUT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const createIssueComment = vi.fn().mockResolvedValue({})
const listIssueComments = vi.fn().mockResolvedValue([])
const listReviewComments = vi.fn().mockResolvedValue([])
const listCheckRunsForRef = vi.fn()
const getPullRequest = vi.fn()
const listPullRequestFiles = vi.fn()

vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...a: unknown[]) => createIssueComment(...a),
  listIssueComments: (...a: unknown[]) => listIssueComments(...a),
  listReviewComments: (...a: unknown[]) => listReviewComments(...a),
  listCheckRunsForRef: (...a: unknown[]) => listCheckRunsForRef(...a),
  getPullRequest: (...a: unknown[]) => getPullRequest(...a),
  listPullRequestFiles: (...a: unknown[]) => listPullRequestFiles(...a),
}))

const SHA = 'a'.repeat(40)

function makeEvent(overrides?: Record<string, unknown>) {
  return {
    pull_request: { number: 100, head: { sha: SHA } },
    review: {
      id: 555,
      body: 'P1: this function has a bug',
      ...(overrides?.review ?? {}),
    },
    ...(overrides ?? {}),
  }
}

function setupAndRun(
  dir: string,
  opts: {
    prBody?: string
    files?: Array<{ filename: string; status: string; previous_filename?: string }>
    prHeadSha?: string
    existingMarkers?: string[]
    event?: Record<string, unknown>
    skipFileMock?: boolean
  } = {},
) {
  const eventPath = join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify(opts.event ?? makeEvent()))
  const outPath = join(dir, 'out.txt')
  writeFileSync(outPath, '')

  listIssueComments.mockResolvedValue(
    (opts.existingMarkers ?? []).map((body) => ({ body })),
  )
  listReviewComments.mockResolvedValue([])
  listCheckRunsForRef.mockResolvedValue([
    { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' },
  ])
  getPullRequest.mockResolvedValue({
    head: { sha: opts.prHeadSha ?? SHA },
    body: opts.prBody ?? '',
  })
  if (!opts.skipFileMock) {
    listPullRequestFiles.mockResolvedValue(
      opts.files ?? [{ filename: 'src/app/dashboard/page.tsx', status: 'modified' }],
    )
  }

  const original = { ...process.env }
  Object.assign(process.env, {
    GITHUB_TOKEN: 'tok',
    GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: outPath,
    OPS_POLL_ATTEMPTS: '1',
    OPS_POLL_INTERVAL_MS: '0',
  })

  return import('../src/handle-review.mjs')
    .then(() => {
      const raw = readFileSync(outPath, 'utf8')
      const outputs: Record<string, string> = {}
      const re = /^(\w+)<<(.+)$/gm
      const lines = raw.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const m = /^(\w+)<<(.+)$/.exec(lines[i])
        if (!m) continue
        const [, name, delim] = m
        const body: string[] = []
        for (i++; i < lines.length; i++) {
          if (lines[i] === delim) break
          body.push(lines[i])
        }
        outputs[name] = body.join('\n')
      }
      return { outputs, comments: createIssueComment.mock.calls }
    })
    .finally(() => {
      process.env = original
    })
}

describe('handle-review risk gate: B-level PR → dispatch fix', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-riskgate-'))
    createIssueComment.mockClear()
    listIssueComments.mockReset().mockResolvedValue([])
    listReviewComments.mockReset().mockResolvedValue([])
    listCheckRunsForRef.mockReset()
    getPullRequest.mockReset()
    listPullRequestFiles.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('allows a B-level PR with no declared risk', async () => {
    const { outputs } = await setupAndRun(dir, {
      files: [{ filename: 'src/app/dashboard/page.tsx', status: 'modified' }],
    })
    expect(outputs.action).toBe('dispatch-fix')
    expect(outputs.risk_grade).toBe('B')
  })

  it('outputs graded_head matching the PR head at grading time', async () => {
    const { outputs } = await setupAndRun(dir, {
      files: [{ filename: 'src/app/dashboard/page.tsx', status: 'modified' }],
    })
    expect(outputs.graded_head).toBe(SHA)
  })
})

describe('handle-review risk gate: A-level PR → blocked', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-riskgate-a-'))
    createIssueComment.mockClear()
    listIssueComments.mockReset().mockResolvedValue([])
    listReviewComments.mockReset().mockResolvedValue([])
    listCheckRunsForRef.mockReset()
    getPullRequest.mockReset()
    listPullRequestFiles.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('blocks when file list hits A-level rule', async () => {
    const { outputs, comments } = await setupAndRun(dir, {
      files: [{ filename: '.github/workflows/ci.yml', status: 'modified' }],
    })
    expect(outputs.action).toBe('a-level-blocked')
    expect(comments).toHaveLength(1)
    const body = String(comments[0][4])
    expect(body).toContain('A 级改动')
    expect(body).toContain('自动修复不推送')
    expect(body).toContain('a-level-blocked')
  })

  it('blocks when body declares A even if files are B-level', async () => {
    const { outputs, comments } = await setupAndRun(dir, {
      prBody: '风险级别：A',
      files: [{ filename: 'src/app/dashboard/page.tsx', status: 'modified' }],
    })
    expect(outputs.action).toBe('a-level-blocked')
    expect(comments).toHaveLength(1)
  })

  it('blocks when files are A even if body declares C', async () => {
    const { outputs } = await setupAndRun(dir, {
      prBody: '风险级别：C',
      files: [{ filename: 'tools/ops-review-loop/src/risk.mjs', status: 'modified' }],
    })
    expect(outputs.action).toBe('a-level-blocked')
  })

  it('includes real reasons from classifyRisk in the comment', async () => {
    const { comments } = await setupAndRun(dir, {
      files: [{ filename: '.github/workflows/ci.yml', status: 'modified' }],
    })
    const body = String(comments[0][4])
    expect(body).not.toBe('')
    expect(body).toContain('.github/')
  })
})

describe('handle-review risk gate: error paths fail closed', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-riskgate-err-'))
    createIssueComment.mockClear()
    listIssueComments.mockReset().mockResolvedValue([])
    listReviewComments.mockReset().mockResolvedValue([])
    listCheckRunsForRef.mockReset()
    getPullRequest.mockReset()
    listPullRequestFiles.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('blocks when listPullRequestFiles throws (e.g. API error)', async () => {
    listPullRequestFiles.mockRejectedValue(new Error('API 500'))
    const { outputs, comments } = await setupAndRun(dir, { skipFileMock: true })
    expect(outputs.action).toBe('a-level-blocked')
    const body = String(comments[0][4])
    expect(body).toContain('风险判定失败')
    expect(body).toContain('API 500')
  })

  it('blocks when listPullRequestFiles throws page cap error', async () => {
    listPullRequestFiles.mockRejectedValue(
      new Error('改动文件超过 3000 上限，无法读全'),
    )
    const { outputs, comments } = await setupAndRun(dir, { skipFileMock: true })
    expect(outputs.action).toBe('a-level-blocked')
    const body = String(comments[0][4])
    expect(body).toContain('风险判定失败')
    expect(body).toContain('上限')
  })
})

describe('handle-review risk gate: A-level dedup', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-riskgate-dedup-'))
    createIssueComment.mockClear()
    listIssueComments.mockReset()
    listReviewComments.mockReset().mockResolvedValue([])
    listCheckRunsForRef.mockReset()
    getPullRequest.mockReset()
    listPullRequestFiles.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('does not post a second A-level comment for the same sha', async () => {
    const existingMarker = `<!-- ops-codex-loop:stage=a-level-blocked pr=100 sha=${SHA} -->`
    const { outputs, comments } = await setupAndRun(dir, {
      files: [{ filename: '.github/workflows/ci.yml', status: 'modified' }],
      existingMarkers: [existingMarker],
    })
    expect(outputs.action).toBe('a-level-blocked')
    expect(comments).toHaveLength(0)
  })
})
