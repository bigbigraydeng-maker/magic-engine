/**
 * Stacked pull requests cannot arm auto-merge. Once the gate has already
 * decided the head is clear, that GitHub limitation must not turn Risk gate
 * red. Every other failure to arm auto-merge still does.
 */
import { describe, expect, it } from 'vitest'

import { planAutoMergeEnable } from '../src/head-check.mjs'
import {
  STACKED_AUTO_MERGE_NOTE,
  classifyStackPayload,
  isStackedAutoMergeRefusal,
  mergeCommand,
  runEnableAutoMerge,
  stackQueryArgs,
} from '../src/enable-auto-merge.mjs'

const HEAD = 'b8ae3e8b6015974044d3aff0c0a525d09368c9a1'
const NEWER = 'e4771192c05a734212740f76da336d273340e7fb'
const REPO = 'acme/widgets'
const STACKED_ERROR =
  'GraphQL: Auto-merge is not supported for stacked pull requests. (enablePullRequestAutoMerge)'
const STACKED_ERROR_ALT =
  'GraphQL: This pull request is part of a stack and must be merged sequentially using the stack merge API. (enablePullRequestAutoMerge)'

interface GhResult {
  code: number
  stdout?: string
  stderr?: string
}

function harness(responses: Record<string, GhResult>, env: Record<string, string> = {}) {
  const calls: string[][] = []
  const summaries: string[] = []
  const notices: string[] = []
  const errors: string[] = []
  const logs: string[] = []
  const exec = (args: string[]) => {
    calls.push(args)
    const key = args[0] === 'pr' && args[1] === 'view' ? 'view' : args[0] === 'api' ? 'stack' : args[1] === 'merge' ? 'merge' : 'other'
    const found = responses[key]
    if (!found) throw new Error(`unexpected gh ${args.join(' ')}`)
    return { code: found.code, stdout: found.stdout ?? '', stderr: found.stderr ?? '' }
  }
  const code = runEnableAutoMerge({
    env: { PR_NUMBER: '3859', GITHUB_REPOSITORY: REPO, HEAD_SHA: HEAD, ...env },
    exec,
    writeSummary: (text) => summaries.push(text),
    writeNotice: (text) => notices.push(text),
    writeError: (text) => errors.push(text),
    writeLog: (text) => logs.push(text),
  })
  return { code, calls, summaries, notices, errors, logs }
}

function viewOk(head = HEAD): GhResult {
  return { code: 0, stdout: `${head}\n` }
}

function stackPayload(stack: unknown): GhResult {
  return { code: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { stack } } } }) }
}

describe('classifyStackPayload', () => {
  it('reads a native stack only from a non-null stack object', () => {
    expect(classifyStackPayload(stackPayload({ number: 7 }).stdout)).toBe('stacked')
    expect(classifyStackPayload(stackPayload(null).stdout)).toBe('plain')
  })

  it('does not treat a failed or incomplete read as stacked', () => {
    expect(classifyStackPayload('not json')).toBe('unknown')
    expect(classifyStackPayload(JSON.stringify({ errors: [{ message: 'no such field' }] }))).toBe('unknown')
    expect(classifyStackPayload(JSON.stringify({ data: { repository: { pullRequest: {} } } }))).toBe('unknown')
    expect(classifyStackPayload(JSON.stringify({ data: { repository: { pullRequest: null } } }))).toBe('unknown')
    expect(classifyStackPayload('')).toBe('unknown')
  })
})

describe('isStackedAutoMergeRefusal', () => {
  it('recognises both GitHub wordings of the stacked auto-merge refusal', () => {
    expect(isStackedAutoMergeRefusal(STACKED_ERROR)).toBe(true)
    expect(isStackedAutoMergeRefusal(`hint\n${STACKED_ERROR_ALT}`)).toBe(true)
  })

  it('rejects other enable failures, including ones that merely mention a stack or the mutation', () => {
    expect(isStackedAutoMergeRefusal('GraphQL: Resource not accessible by integration. (enablePullRequestAutoMerge)')).toBe(false)
    expect(isStackedAutoMergeRefusal('stacked pull request')).toBe(false)
    expect(isStackedAutoMergeRefusal('Auto-merge is not supported for this repository.')).toBe(false)
    expect(isStackedAutoMergeRefusal('')).toBe(false)
    expect(isStackedAutoMergeRefusal(undefined)).toBe(false)
  })
})

describe('mergeCommand', () => {
  it('forwards only a pinned enable, and never an admin merge', () => {
    const plan = planAutoMergeEnable({ boundHead: HEAD, liveHead: HEAD })
    expect(mergeCommand(plan, '3859')).toEqual(['pr', 'merge', '--auto', '--merge', '--match-head-commit', HEAD, '3859'])
    expect(mergeCommand({ enable: true, args: ['pr', 'merge', '--auto', '--merge', '--admin', '--match-head-commit', HEAD] }, '3859')).toBeNull()
    expect(mergeCommand(planAutoMergeEnable({ boundHead: HEAD, liveHead: NEWER }), '3859')).toBeNull()
    expect(mergeCommand(plan, '0')).toBeNull()
  })
})

describe('stackQueryArgs', () => {
  it('asks GraphQL for PullRequest.stack and refuses a malformed repository', () => {
    expect(stackQueryArgs(REPO, '3859')).toEqual([
      'api',
      'graphql',
      '-f',
      expect.stringContaining('stack{number}'),
      '-F',
      'owner=acme',
      '-F',
      'name=widgets',
      '-F',
      'number=3859',
    ])
    expect(stackQueryArgs('acme/widgets/extra', '3859')).toBeNull()
    expect(stackQueryArgs(REPO, 'nope')).toBeNull()
  })
})

describe('runEnableAutoMerge', () => {
  it('passes a stacked pull request without calling merge, and writes the manual-merge note', () => {
    const result = harness({ view: viewOk(), stack: stackPayload({ number: 4 }) })
    expect(result.code).toBe(0)
    expect(result.calls.some((args) => args[1] === 'merge')).toBe(false)
    expect(result.summaries).toEqual([`- ${STACKED_AUTO_MERGE_NOTE}`])
    expect(result.notices).toEqual([STACKED_AUTO_MERGE_NOTE])
    expect(result.errors).toEqual([])
  })

  it('arms auto-merge for a pull request that is not in a stack', () => {
    const result = harness({ view: viewOk(), stack: stackPayload(null), merge: { code: 0, stdout: 'ok\n' } })
    expect(result.code).toBe(0)
    expect(result.calls.at(-1)).toEqual(['pr', 'merge', '--auto', '--merge', '--match-head-commit', HEAD, '3859'])
    expect(result.summaries).toEqual(['- 自动合并：已开启（必过检查全绿后由 GitHub 合并）'])
    expect(result.notices).toEqual([])
  })

  it('still passes when the stack query fails and the merge command returns the stacked refusal', () => {
    const result = harness({
      view: viewOk(),
      stack: { code: 1, stderr: 'Field stack is not available' },
      merge: { code: 1, stderr: STACKED_ERROR },
    })
    expect(result.code).toBe(0)
    expect(result.calls.some((args) => args[1] === 'merge')).toBe(true)
    expect(result.summaries).toEqual([`- ${STACKED_AUTO_MERGE_NOTE}`])
    expect(result.logs.join('\n')).toContain('enablePullRequestAutoMerge')
  })

  it('stays red when auto-merge fails for a reason other than a stack', () => {
    const result = harness({
      view: viewOk(),
      stack: stackPayload(null),
      merge: { code: 1, stderr: 'GraphQL: Required status check is failing. (enablePullRequestAutoMerge)' },
    })
    expect(result.code).toBe(1)
    expect(result.summaries).toEqual(['- 自动合并：开启失败'])
    expect(result.notices).toEqual([])
    expect(result.errors).toEqual(['自动合并：开启失败'])
  })

  it('does not merge or call the pull request stacked when the reviewed head is already stale', () => {
    const result = harness({ view: viewOk(NEWER) })
    expect(result.code).toBe(0)
    expect(result.calls).toHaveLength(1)
    expect(result.summaries).toEqual(['- 自动合并：未开启（这次审的提交已经不是 PR 当前提交）'])
    expect(result.notices).toEqual([])
  })

  it('stays red when the live head cannot be read, and does not go on to merge', () => {
    const result = harness({ view: { code: 1, stderr: 'HTTP 502' } })
    expect(result.code).toBe(1)
    expect(result.calls).toHaveLength(1)
    expect(result.summaries).toEqual(['- 自动合并：未开启（无法确认当前提交）'])
    expect(result.logs.join('\n')).toContain('HTTP 502')
  })

  it('stays red when the pull request number is not one this command can pin', () => {
    const result = harness({ view: viewOk() }, { PR_NUMBER: '0' })
    expect(result.code).toBe(1)
    expect(result.calls.some((args) => args[1] === 'merge')).toBe(false)
    expect(result.summaries).toEqual(['- 自动合并：未开启（无法确认当前提交）'])
  })
})
