import { describe, expect, it } from 'vitest'
import { describeDraft, validateDraft, type AdDraft } from '../ad-draft'
import { pausedDraftFacts, type PausedDraftReview } from '../paused-draft-facts'

const REVIEW: PausedDraftReview = {
  adAccountId: 'act_1',
  accounts: [{
    ad_account_id: 'act_1', currency: 'NZD', daily_cap_cents: 10000, owned_by_client: true,
  }],
  clientCapCents: 20000,
}

function draft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'video_thruplay',
    clientId: 'c1',
    campaignName: 'video campaign',
    adSetName: 'group',
    dailyBudget: 15,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'p1',
    linkUrl: 'https://example.co.nz',
    creatives: [{
      name: 'V', primaryText: 'Watch the route', headline: 'Play', videoId: 'v1', thumbnailImageHash: 'th1',
    }],
    ...over,
  }
}

describe('已有广告组编号', () => {
  it('格式不对，或和已有系列一起写，复核不过', () => {
    expect(validateDraft(draft({ existingAdSetId: 'set-a' })).some((p) => p.field === 'existingAdSetId')).toBe(true)
    const both = validateDraft(draft({ existingCampaignId: '900001', existingAdSetId: '800001' }))
    expect(both.some((p) => p.message.includes('分成两张卡'))).toBe(true)
  })

  it('确认卡写明是加到已有广告组，换编号指纹就变', () => {
    const first = pausedDraftFacts(draft({ existingAdSetId: '800001' }), '账户', REVIEW)
    const second = pausedDraftFacts(draft({ existingAdSetId: '800002' }), '账户', REVIEW)
    expect(first.scope).toContain('已有广告组')
    expect(first.scope).not.toBe(second.scope)
    expect(describeDraft(draft({ existingAdSetId: '800001' }))).toContain('已有广告组')
  })
})
