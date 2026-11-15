import { describe, expect, it } from 'vitest'
import { normalizeBindCode, parseTelegramStartPayload } from '../fde-telegram-bind'

describe('fde telegram bind parsing', () => {
  it('accepts /start code', () => {
    expect(parseTelegramStartPayload('/start abcd1234')).toBe('abcd1234')
    expect(parseTelegramStartPayload('/start@MeBot abcd1234')).toBe('abcd1234')
  })

  it('rejects malformed codes', () => {
    expect(parseTelegramStartPayload('/start')).toBeNull()
    expect(normalizeBindCode('xyz')).toBeNull()
  })
})