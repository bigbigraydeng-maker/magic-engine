/**
 * Unit tests for AES-256-GCM CMS token encryption.
 *
 * These tests use a known 32-byte test key injected via process.env so they
 * can run without the production key being present.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encryptToken, decryptToken, tokenLastFour, _resetKeyCache } from './crypto'

// 32-byte hex test key (NOT the production key)
const TEST_KEY = 'a'.repeat(64) // 64 hex chars = 32 bytes

function withTestKey(fn: () => void | Promise<void>) {
  return async () => {
    const original = process.env.CMS_TOKEN_ENCRYPTION_KEY
    process.env.CMS_TOKEN_ENCRYPTION_KEY = TEST_KEY
    _resetKeyCache()
    try {
      await fn()
    } finally {
      process.env.CMS_TOKEN_ENCRYPTION_KEY = original
      _resetKeyCache()
    }
  }
}

// ─── encryptToken / decryptToken ─────────────────────────────────────────────

describe('encryptToken', () => {
  it('returns a dot-delimited string with 3 segments', withTestKey(() => {
    const ciphertext = encryptToken('ghp_testtoken1234')
    const parts = ciphertext.split('.')
    expect(parts).toHaveLength(3)
    expect(parts.every(p => p.length > 0)).toBe(true)
  }))

  it('produces different ciphertext on each call (random IV)', withTestKey(() => {
    const a = encryptToken('same-token')
    const b = encryptToken('same-token')
    expect(a).not.toBe(b)
  }))

  it('round-trips correctly', withTestKey(() => {
    const original  = 'ghp_MySecretPAT_1234567890abcdef'
    const encrypted = encryptToken(original)
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(original)
  }))

  it('round-trips an empty string', withTestKey(() => {
    const encrypted = encryptToken('')
    expect(decryptToken(encrypted)).toBe('')
  }))

  it('round-trips unicode content', withTestKey(() => {
    const token     = 'token_with_unicode_αβγδ_🚀'
    const encrypted = encryptToken(token)
    expect(decryptToken(encrypted)).toBe(token)
  }))
})

describe('decryptToken', () => {
  it('throws on invalid format (too few segments)', withTestKey(() => {
    expect(() => decryptToken('onlyone')).toThrow('3 dot-delimited segments')
  }))

  it('throws on invalid format (too many segments)', withTestKey(() => {
    expect(() => decryptToken('a.b.c.d')).toThrow('3 dot-delimited segments')
  }))

  it('throws when ciphertext is tampered', withTestKey(() => {
    const encrypted = encryptToken('real-token')
    const parts     = encrypted.split('.')
    // Corrupt the ciphertext segment
    const tampered  = [parts[0], parts[1], 'AAAAAAAAAA=='].join('.')
    expect(() => decryptToken(tampered)).toThrow()
  }))

  it('throws when auth tag is tampered', withTestKey(() => {
    const encrypted = encryptToken('real-token')
    const parts     = encrypted.split('.')
    const tampered  = [parts[0], 'AAAAAAAAAAAAAAAAAAAAAA==', parts[2]].join('.')
    expect(() => decryptToken(tampered)).toThrow()
  }))
})

describe('decryptToken — wrong key', () => {
  it('throws when decrypting with a different key', async () => {
    // Encrypt with key A
    process.env.CMS_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)
    _resetKeyCache()
    const encrypted = encryptToken('my-github-pat')

    // Decrypt with key B
    process.env.CMS_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64)
    _resetKeyCache()
    expect(() => decryptToken(encrypted)).toThrow()
  })
})

// ─── tokenLastFour ────────────────────────────────────────────────────────────

describe('tokenLastFour', () => {
  it('returns last 4 chars', () => {
    expect(tokenLastFour('ghp_1234567890abcdef')).toBe('cdef')
  })

  it('handles short strings', () => {
    expect(tokenLastFour('ab')).toBe('ab')
  })

  it('returns empty string for empty input', () => {
    expect(tokenLastFour('')).toBe('')
  })
})

// ─── missing env var ─────────────────────────────────────────────────────────

describe('encryptToken — missing key', () => {
  beforeEach(() => {
    delete process.env.CMS_TOKEN_ENCRYPTION_KEY
    _resetKeyCache()
  })
  afterEach(() => {
    _resetKeyCache()
  })

  it('throws a descriptive error when key is not set', () => {
    expect(() => encryptToken('any')).toThrow('CMS_TOKEN_ENCRYPTION_KEY')
  })
})

describe('encryptToken — invalid key length', () => {
  beforeEach(() => {
    process.env.CMS_TOKEN_ENCRYPTION_KEY = 'tooshort'
    _resetKeyCache()
  })
  afterEach(() => {
    _resetKeyCache()
  })

  it('throws when the key is the wrong length', () => {
    expect(() => encryptToken('any')).toThrow('64-character hex string')
  })
})
