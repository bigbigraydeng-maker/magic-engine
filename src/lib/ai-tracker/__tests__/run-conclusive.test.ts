// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isRunConclusive,
  partitionConclusiveRuns,
  summariseRunFailures,
} from '../run-conclusive'

describe('isRunConclusive', () => {
  it('accepts a run where both the engine call and the parse completed', () => {
    expect(isRunConclusive({ error_message: null, parse_error_message: null })).toBe(true)
  })

  it('returns true when error_message is no_ai_overview (successful zero)', () => {
    expect(isRunConclusive({ error_message: 'no_ai_overview', parse_error_message: null })).toBe(true)
  })

  it('rejects a run whose engine call failed', () => {
    expect(
      isRunConclusive({ error_message: 'Connection error.', parse_error_message: null })
    ).toBe(false)
  })

  it('rejects a run whose engine answered but whose parser threw', () => {
    expect(
      isRunConclusive({ error_message: null, parse_error_message: 'LLM parse timeout' })
    ).toBe(false)
  })

  it('returns false when both error fields are set', () => {
    expect(isRunConclusive({ error_message: 'timeout', parse_error_message: 'broken JSON' })).toBe(false)
  })

  it('treats missing fields as null (for objects from different queries)', () => {
    expect(isRunConclusive({})).toBe(true)
    expect(isRunConclusive({ error_message: undefined })).toBe(true)
  })

  it('trims whitespace before checking', () => {
    expect(isRunConclusive({ error_message: '  ', parse_error_message: null })).toBe(true)
    expect(isRunConclusive({ error_message: ' no_ai_overview ', parse_error_message: null })).toBe(true)
  })
})

describe('partitionConclusiveRuns', () => {
  it('splits rows without dropping any', () => {
    const rows = [
      { error_message: null, parse_error_message: null, id: 'a' },
      { error_message: 'boom', parse_error_message: null, id: 'b' },
      { error_message: null, parse_error_message: 'parse boom', id: 'c' },
      { error_message: null, parse_error_message: null, id: 'd' },
    ]
    const { conclusive, failed } = partitionConclusiveRuns(rows)
    expect(conclusive.map(r => r.id)).toEqual(['a', 'd'])
    expect(failed.map(r => r.id)).toEqual(['b', 'c'])
  })

  it('returns two empty buckets for no rows', () => {
    expect(partitionConclusiveRuns([])).toEqual({ conclusive: [], failed: [] })
  })
})

describe('summariseRunFailures', () => {
  it('names each leg and how many, so a reader can tell a provider outage from a parser bug', () => {
    const summary = summariseRunFailures([
      { error_message: 'timeout', parse_error_message: null },
      { error_message: '429 rate limit', parse_error_message: null },
      { error_message: null, parse_error_message: 'bad JSON' },
    ])
    expect(summary).toBe('2 次引擎调用失败，1 次结果解析失败')
  })

  it('counts a row whose engine failed once, not twice', () => {
    expect(
      summariseRunFailures([{ error_message: 'timeout', parse_error_message: 'bad JSON' }])
    ).toBe('1 次引擎调用失败')
  })

  it('says so plainly when there is nothing to report', () => {
    expect(summariseRunFailures([])).toBe('无失败记录')
  })
})
