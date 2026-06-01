/**
 * TDD — RED Phase
 * Tests for shared validation utility functions.
 *
 * Covers HIGH-1: limit parameter has no upper bound, allowing DoS via
 * unbounded database queries. Also covers the auth middleware utility.
 *
 * These utils are extracted for reuse across all API routes.
 *
 * Reference: Phase 7.3 security fix
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  clampLimit,
  requireBearerToken,
  validateEnvVar,
} from '../validation-utils'

// ---------------------------------------------------------------------------
// Tests: clampLimit
// ---------------------------------------------------------------------------

describe('clampLimit', () => {
  it('returns default (20) when input is undefined', () => {
    expect(clampLimit(undefined)).toBe(20)
  })

  it('returns default (20) when input is null string', () => {
    expect(clampLimit(null)).toBe(20)
  })

  it('returns default when input is empty string', () => {
    expect(clampLimit('')).toBe(20)
  })

  it('returns default when input is non-numeric string', () => {
    expect(clampLimit('abc')).toBe(20)
  })

  it('caps at 100 when value exceeds maximum', () => {
    expect(clampLimit('999')).toBe(100)
    expect(clampLimit('101')).toBe(100)
    expect(clampLimit('1000000')).toBe(100)
  })

  it('caps at 100 exactly at the boundary', () => {
    expect(clampLimit('100')).toBe(100)
  })

  it('allows values within range (1-99)', () => {
    expect(clampLimit('50')).toBe(50)
    expect(clampLimit('1')).toBe(1)
    expect(clampLimit('99')).toBe(99)
  })

  it('returns default (20) for negative numbers', () => {
    expect(clampLimit('-1')).toBe(20)
    expect(clampLimit('-100')).toBe(20)
  })

  it('returns default (20) for zero', () => {
    expect(clampLimit('0')).toBe(20)
  })

  it('accepts a custom default value', () => {
    expect(clampLimit(undefined, { defaultValue: 50 })).toBe(50)
  })

  it('accepts a custom max value', () => {
    expect(clampLimit('200', { max: 150 })).toBe(150)
    expect(clampLimit('100', { max: 150 })).toBe(100)
  })

  it('handles decimal strings by flooring to integer', () => {
    expect(clampLimit('25.9')).toBe(25)
  })

  it('handles large integer strings without overflow', () => {
    // Number.MAX_SAFE_INTEGER in string form
    expect(clampLimit('9007199254740991')).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Tests: requireBearerToken
// ---------------------------------------------------------------------------

describe('requireBearerToken', () => {
  let savedKey: string | undefined

  const expectAuthFailure = (
    result: ReturnType<typeof requireBearerToken>,
    status: 401 | 500,
  ) => {
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(status)
    }
  }

  beforeEach(() => {
    savedKey = process.env.INTERNAL_API_KEY
    process.env.INTERNAL_API_KEY = 'secret-test-key'
  })

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.INTERNAL_API_KEY = savedKey
    } else {
      delete process.env.INTERNAL_API_KEY
    }
  })

  it('returns { ok: false, status: 401 } when header is missing', () => {
    const result = requireBearerToken(undefined)
    expectAuthFailure(result, 401)
  })

  it('returns { ok: false, status: 401 } when token is wrong', () => {
    const result = requireBearerToken('Bearer wrong-token')
    expectAuthFailure(result, 401)
  })

  it('returns { ok: false, status: 401 } for non-Bearer scheme', () => {
    const result = requireBearerToken('Basic secret-test-key')
    expectAuthFailure(result, 401)
  })

  it('returns { ok: false, status: 401 } for empty Bearer token', () => {
    const result = requireBearerToken('Bearer ')
    expectAuthFailure(result, 401)
  })

  it('returns { ok: true } when token matches INTERNAL_API_KEY', () => {
    const result = requireBearerToken('Bearer secret-test-key')
    expect(result.ok).toBe(true)
  })

  it('returns { ok: false, status: 500 } when INTERNAL_API_KEY env var is not set', () => {
    delete process.env.INTERNAL_API_KEY
    const result = requireBearerToken('Bearer anything')
    // Config error, not auth error
    expectAuthFailure(result, 500)
  })

  it('error message does NOT reveal token value', () => {
    const result = requireBearerToken('Bearer wrong')
    expect(result.ok).toBe(false)
    // Error message should be generic
    if (!result.ok) {
      expect(result.error).not.toContain('secret-test-key')
      expect(result.error).not.toContain('wrong')
    }
  })

  it('performs constant-time-safe comparison (does not short-circuit on length)', () => {
    // A timing-safe check still returns 401 for a token that is the right length
    // but wrong value (we cannot test timing directly, but we verify it does not
    // accept a partial prefix match)
    const result = requireBearerToken('Bearer secret-test') // prefix of the real key
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: validateEnvVar
// ---------------------------------------------------------------------------

describe('validateEnvVar', () => {
  let savedKey: string | undefined

  beforeEach(() => {
    savedKey = process.env.TEST_VAR_MAGIC
    delete process.env.TEST_VAR_MAGIC
  })

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.TEST_VAR_MAGIC = savedKey
    } else {
      delete process.env.TEST_VAR_MAGIC
    }
  })

  it('throws with variable name in message when env var is missing', () => {
    expect(() => validateEnvVar('TEST_VAR_MAGIC')).toThrow(/TEST_VAR_MAGIC/)
  })

  it('throws with variable name in message when env var is empty string', () => {
    process.env.TEST_VAR_MAGIC = ''
    expect(() => validateEnvVar('TEST_VAR_MAGIC')).toThrow(/TEST_VAR_MAGIC/)
  })

  it('returns the value when env var is set and non-empty', () => {
    process.env.TEST_VAR_MAGIC = 'my-value'
    expect(validateEnvVar('TEST_VAR_MAGIC')).toBe('my-value')
  })

  it('does NOT include the value in the error message', () => {
    process.env.TEST_VAR_MAGIC = 'super-secret'
    // Delete it to trigger the error
    delete process.env.TEST_VAR_MAGIC

    try {
      validateEnvVar('TEST_VAR_MAGIC')
      expect.fail('should have thrown')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      expect(msg).not.toContain('super-secret')
    }
  })
})
