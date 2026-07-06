import { describe, it, expect } from 'vitest'
import { brandMentioned } from '../analyze'

describe('brandMentioned', () => {
  it('matches an exact brand mention case-insensitively', () => {
    expect(brandMentioned('I recommend Oz Flooring Co for timber floors.', 'Oz Flooring Co')).toBe(true)
  })

  it('matches when the answer drops the legal suffix', () => {
    expect(brandMentioned('Oz Flooring is highly rated in Brisbane.', 'Oz Flooring Pty Ltd')).toBe(true)
  })

  it('does not match a different business', () => {
    expect(brandMentioned('Top picks: Brisbane Timber Floors and FloorFlow.', 'Oz Flooring Co')).toBe(false)
  })

  it('handles punctuation and ampersands in names', () => {
    expect(brandMentioned('Smith & Jones Plumbing is a great choice.', 'Smith & Jones Plumbing')).toBe(true)
  })

  it('never matches on an empty name', () => {
    expect(brandMentioned('any answer', '')).toBe(false)
  })
})
