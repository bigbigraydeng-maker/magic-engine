import { describe, expect, it } from 'vitest'
import { stageCountsAsDeal, UNCONFIGURED_DEAL_STAGE } from '../crm-deal-stage'

describe('stageCountsAsDeal', () => {
  it('uses the historical won step only when nothing is saved', () => {
    expect(UNCONFIGURED_DEAL_STAGE).toBe('won')
    expect(stageCountsAsDeal(null, 'won')).toBe(true)
    expect(stageCountsAsDeal(null, 'quoted', 'won')).toBe(true)
    expect(stageCountsAsDeal(null, 'quoted')).toBe(false)
    expect(stageCountsAsDeal(null, 'postsale', 'postsale')).toBe(false)
  })

  it('a saved stage replaces the fallback', () => {
    expect(stageCountsAsDeal('booked', 'booked', 'won')).toBe(true)
    expect(stageCountsAsDeal('booked', 'won', 'won')).toBe(false)
  })
})
