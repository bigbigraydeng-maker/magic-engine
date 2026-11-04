import { describe, expect, it } from 'vitest'
import { registeredAccountMatch } from '../registered-account-match'

describe('registeredAccountMatch', () => {
  it('matches with or without the act_ prefix and returns the registered spelling', () => {
    expect(registeredAccountMatch('act_42', ['42'])).toBe('42')
    expect(registeredAccountMatch('42', ['act_42'])).toBe('act_42')
  })

  it('returns null when the card account is not registered to this client', () => {
    expect(registeredAccountMatch('act_42', ['99'])).toBeNull()
    expect(registeredAccountMatch('', ['42'])).toBeNull()
  })
})
