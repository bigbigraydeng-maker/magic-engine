import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * W48b-1: Assert the AI judge prompt contains the "new facts = contradiction"
 * sentence and does NOT contain the legacy "added detail are fine" wording.
 * If someone removes or weakens the prompt, these tests break before production.
 *
 * 子牙 instruction #6: also assert the prompt mentions destination/itinerary
 * cities, trip duration, and discount/promotion as invented-fact examples.
 */
describe('AI judge prompt content assertions (W48b-1)', () => {
  const source = readFileSync(resolve(__dirname, '../fact-check.ts'), 'utf8')

  it('prompt contains "new facts = contradiction" sentence', () => {
    expect(source).toContain(
      'Concrete facts in the NEW text that are NOT present in or derivable from the ORIGINAL',
    )
  })

  it('prompt does NOT contain legacy "added detail are fine" wording', () => {
    expect(source).not.toContain('added detail are fine')
  })

  it('prompt mentions destination/itinerary cities as invented-fact examples', () => {
    expect(source).toContain('destination or itinerary city')
  })

  it('prompt mentions trip duration as an invented-fact example', () => {
    expect(source).toContain('trip duration')
  })

  it('prompt mentions discount/promotion as an invented-fact example', () => {
    expect(source).toContain('discount or promotion')
  })
})
