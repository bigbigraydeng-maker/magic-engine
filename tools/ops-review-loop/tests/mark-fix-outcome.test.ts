import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const createIssueComment = vi.fn().mockResolvedValue({})
vi.mock('../src/github.mjs', () => ({ createIssueComment: (...args) => createIssueComment(...args) }))

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
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('posts the fix-dispatched marker only when the outcome is success', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 906, head: { sha: 'abc1234' } } }))

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
