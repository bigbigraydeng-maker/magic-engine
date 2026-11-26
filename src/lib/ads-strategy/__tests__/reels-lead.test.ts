import { describe, expect, it } from 'vitest'
import { DRAFT_PLAY, describeDraft, metaTripletFor, validateDraft, type AdDraft } from '../ad-draft'
import { pausedDraftBlock, pausedDraftFacts } from '../paused-draft-facts'
import { reelsLeadOpenBlocked, reelsLeadPublishRefusal, REELS_LEAD_PLACEMENTS } from '../reels-lead'

function reels(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'reels_lead',
    clientId: 'c1',
    campaignName: 'Reels lead',
    adSetName: 'Reels NZ',
    dailyBudget: 20,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'page-1',
    leadFormId: 'form-1',
    placements: [...REELS_LEAD_PLACEMENTS],
    creatives: [{
      name: 'V',
      primaryText: 'Ask for the brochure',
      headline: 'Leave your details',
      videoId: 'video-1',
      thumbnailImageHash: 'thumb-1',
    }],
    ...over,
  }
}

const REVIEW = {
  adAccountId: 'act_test',
  accounts: [{ ad_account_id: 'act_test', currency: 'NZD', daily_cap_cents: 10000, owned_by_client: true }],
  clientCapCents: 20000,
  liveDeliveringCents: 0,
  campaignShapes: [],
}

describe('reels_lead draft rules', () => {
  it('reuses the lead-form objective and play, and describes the video', () => {
    expect(metaTripletFor('reels_lead')).toEqual(metaTripletFor('lead_form'))
    expect(DRAFT_PLAY.reels_lead).toBe('lead_form_harvest')
    expect(describeDraft(reels())).toContain('短视频留资')
    expect(validateDraft(reels())).toEqual([])
  })

  it('refuses a missing video, a picture, a missing cover, or a missing form', () => {
    expect(validateDraft(reels({
      creatives: [{ name: 'V', primaryText: 'Ask', headline: 'Go', imageHash: 'pic-1' }],
    })).map((problem) => problem.field)).toEqual([
      'creatives[0].videoId',
      'creatives[0].imageHash',
    ])
    expect(validateDraft(reels({
      creatives: [{ name: 'V', primaryText: 'Ask', headline: 'Go', videoId: 'video-1' }],
    })).map((problem) => problem.field)).toEqual(['creatives[0].thumbnail'])
    expect(validateDraft(reels({ leadFormId: undefined })).map((problem) => problem.field)).toContain('leadFormId')
  })

  it('does not invent placements and does not attach to an existing ad set', () => {
    expect(validateDraft(reels({ placements: undefined })).map((problem) => problem.message).join(' ')).toContain('不会替你选')
    expect(validateDraft(reels({ placements: ['instagram_reels'] }))).not.toEqual([])
    expect(validateDraft(reels({ placements: ['facebook_reels', 'instagram_reels', 'facebook_feed'] }))).not.toEqual([])
    expect(validateDraft(reels({ existingAdSetId: '900001' })).map((problem) => problem.field)).toContain('existingAdSetId')
    expect(validateDraft(reels({
      adSets: [{ name: 'one', dailyBudget: 20, geoCountries: ['NZ'], creatives: reels().creatives, placements: [...REELS_LEAD_PLACEMENTS] }],
    })).map((problem) => problem.field)).toContain('adSets')
  })

  it('lets the paused-draft card accept one complete draft and still says it stays off', () => {
    const facts = pausedDraftFacts(reels(), '演示账户', REVIEW)
    expect(facts.scope).toContain('不开启')
    expect(facts.scope).toContain('短视频留资')
    expect(facts.hardChecks.find((check) => check.label === '建前复核')?.state).toBe('green')
    expect(facts.hardChecks.find((check) => check.label === '能按草稿建成暂停')?.state).toBe('green')
    expect(pausedDraftBlock(reels(), '演示账户', REVIEW)).toBeNull()
    const blocked = pausedDraftFacts(reels({ placements: [] }), '演示账户', REVIEW)
    expect(blocked.hardChecks.find((check) => check.label === '建前复核')?.state).toBe('red')
    expect(pausedDraftBlock(reels({ placements: [] }), '演示账户', REVIEW)).not.toBeNull()
  })

  it('matches an existing lead campaign and refuses the old open button', () => {
    const onCampaign = pausedDraftFacts(reels({ existingCampaignId: '800001' }), '演示账户', {
      ...REVIEW,
      campaignShapes: [{ entityId: '800001', objective: 'OUTCOME_LEADS', budgetLevel: 'abo' }],
    })
    expect(onCampaign.hardChecks.find((check) => check.label === '系列目标和预算')?.state).toBe('green')
    expect(reelsLeadOpenBlocked('reels_lead', 'ad-approval')).toBe(true)
    expect(reelsLeadOpenBlocked('reels_lead', 'go-live-card')).toBe(false)
    expect(reelsLeadOpenBlocked('lead_form', 'ad-approval')).toBe(false)
    expect(reelsLeadPublishRefusal(reels())).toBeNull()
    expect(reelsLeadPublishRefusal(reels({
      creatives: [{ name: 'V', primaryText: 'Ask', headline: 'Go' }],
    }))?.step).toBe('creative')
  })
})
