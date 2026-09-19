import { describe, expect, it } from 'vitest'
import { classifyMetaChangeOutcome, MIN_IMPRESSIONS_FOR_CLASSIFICATION } from '../outcome-classifier'

describe('classifyMetaChangeOutcome — sample-size floor (魏征 finding #11)', () => {
  it('returns insufficient_data when baseline impressions are below the floor even if the CTR delta looks huge', () => {
    // 1 click / 3 impressions -> 2 clicks / 3 impressions looks like a +33pp "improvement" — it's noise.
    const result = classifyMetaChangeOutcome(
      { ctr: 33.3, position: 10, impressions: 3 },
      { ctr: 66.6, position: 9, impressions: 3, clicks: 2 },
    )
    expect(result.outcome).toBe('insufficient_data')
  })

  it('returns insufficient_data when observed impressions are below the floor', () => {
    const result = classifyMetaChangeOutcome(
      { ctr: 5, position: 10, impressions: 100 },
      { ctr: 20, position: 9, impressions: 5, clicks: 1 },
    )
    expect(result.outcome).toBe('insufficient_data')
  })

  it('classifies improved when both windows clear the floor and CTR rose meaningfully', () => {
    const result = classifyMetaChangeOutcome(
      { ctr: 5, position: 10, impressions: 200 },
      { ctr: 9, position: 9, impressions: 200, clicks: 18 },
    )
    expect(result.outcome).toBe('improved')
  })

  it('classifies regressed when both windows clear the floor and CTR dropped meaningfully', () => {
    const result = classifyMetaChangeOutcome(
      { ctr: 8, position: 10, impressions: 200 },
      { ctr: 3, position: 12, impressions: 200, clicks: 6 },
    )
    expect(result.outcome).toBe('regressed')
  })

  it('classifies flat when the delta is within the flat band', () => {
    const result = classifyMetaChangeOutcome(
      { ctr: 5, position: 10, impressions: 200 },
      { ctr: 5.5, position: 10, impressions: 200, clicks: 11 },
    )
    expect(result.outcome).toBe('flat')
  })

  it('never returns improved/regressed at exactly the floor minus one', () => {
    const result = classifyMetaChangeOutcome(
      { ctr: 5, position: 10, impressions: MIN_IMPRESSIONS_FOR_CLASSIFICATION - 1 },
      { ctr: 50, position: 1, impressions: MIN_IMPRESSIONS_FOR_CLASSIFICATION - 1, clicks: 15 },
    )
    expect(result.outcome).toBe('insufficient_data')
  })
})
