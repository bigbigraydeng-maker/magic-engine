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

  it('rejects a run whose engine call failed', () => {
    expect(
      isRunConclusive({ error_message: 'Connection error.', parse_error_message: null })
    ).toBe(false)
  })

  it('rejects a run whose engine answered but whose parser threw', () => {
    // The trap this module exists for: the engine may well have named the
    // client, but client_brand_rank is null because nothing parsed it. Left in
    // the denominator it reads as a confirmed miss.
    expect(
      isRunConclusive({ error_message: null, parse_error_message: 'LLM parse timeout' })
    ).toBe(false)
  })

  it('treats an empty string as a failure, not as "no error"', () => {
    // Fail-closed: a writer that records an empty message still recorded a
    // failure leg, and guessing otherwise would re-open the exact hole.
    expect(isRunConclusive({ error_message: '', parse_error_message: null })).toBe(false)
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
