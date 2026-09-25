import { describe, it, expect } from 'vitest'
import { isRunConclusive } from '../run-conclusive'

describe('isRunConclusive', () => {
  it('returns true for a clean run (both fields null)', () => {
    expect(isRunConclusive({ error_message: null, parse_error_message: null })).toBe(true)
  })

  it('returns true when error_message is no_ai_overview (successful zero)', () => {
    expect(isRunConclusive({ error_message: 'no_ai_overview', parse_error_message: null })).toBe(true)
  })

  it('returns false when error_message is a real error', () => {
    expect(isRunConclusive({ error_message: 'ECONNREFUSED', parse_error_message: null })).toBe(false)
  })

  it('returns false when parse_error_message is set', () => {
    expect(isRunConclusive({ error_message: null, parse_error_message: 'unexpected token' })).toBe(false)
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
