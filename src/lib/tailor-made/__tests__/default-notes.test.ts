import { describe, expect, it } from 'vitest'
import { createBlankItinerary } from '../types'

// A brand-new quote (not copied from an old one) must carry the agent-facing
// pricing notes; before this they only existed on quotes copied from older ones.
describe('createBlankItinerary default notes', () => {
  const notes = createBlankItinerary('TM-2026-0001').notes

  it('states quotes are net and exclude commission', () => {
    expect(notes).toContain('All quotations provided are net rates and do not include any commission.')
  })

  it('reserves the right to adjust prices for exchange-rate changes', () => {
    expect(notes.some(n => /exchange rate/i.test(n) && /reserve the right/i.test(n))).toBe(true)
  })
})
