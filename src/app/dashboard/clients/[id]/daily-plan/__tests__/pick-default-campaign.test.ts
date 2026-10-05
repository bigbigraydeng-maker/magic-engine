import { describe, it, expect } from 'vitest'
import { pickDefaultCampaignId } from '../pick-default-campaign'

describe('pickDefaultCampaignId', () => {
  it('picks the requested campaign when it is in the active list', () => {
    const campaigns = [{ id: 'a' }, { id: 'b' }]
    expect(pickDefaultCampaignId(campaigns, 'b')).toBe('b')
  })

  it('falls back to the first campaign when no id was requested', () => {
    const campaigns = [{ id: 'a' }, { id: 'b' }]
    expect(pickDefaultCampaignId(campaigns, null)).toBe('a')
  })

  it('falls back to the first campaign when the requested id is archived or unknown', () => {
    const campaigns = [{ id: 'a' }, { id: 'b' }]
    expect(pickDefaultCampaignId(campaigns, 'does-not-exist')).toBe('a')
  })

  it('returns null when there are no active campaigns', () => {
    expect(pickDefaultCampaignId([], 'anything')).toBeNull()
    expect(pickDefaultCampaignId([], null)).toBeNull()
  })
})
