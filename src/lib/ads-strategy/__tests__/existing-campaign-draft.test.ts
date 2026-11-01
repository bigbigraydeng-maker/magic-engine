import { describe, expect, it } from 'vitest'
import { describeDraft, validateDraft, type AdDraft } from '../ad-draft'
import { draftNotYetBuildable } from '../ad-draft-expansion'
import { pausedDraftFacts, type PausedDraftReview } from '../paused-draft-facts'

const REVIEW: PausedDraftReview = {
  adAccountId: 'act_1',
  accounts: [{
    ad_account_id: 'act_1',
    currency: 'NZD',
    daily_cap_cents: 10000,
    owned_by_client: true,
  }],
  clientCapCents: 20000,
  liveDeliveringCents: 0,
  campaignShapes: [{ entityId: '900001', objective: 'OUTCOME_LEADS', budgetLevel: 'abo' }],
}

function draft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'lead_form',
    clientId: 'c1',
    campaignName: 'lead campaign',
    adSetName: 'group',
    dailyBudget: 30,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'p1',
    leadFormId: 'f1',
    linkUrl: 'https://example.co.nz',
    creatives: [{ name: 'EN', primaryText: 'Book a tour', headline: 'See dates', imageHash: 'h1' }],
    ...over,
  }
}

describe('已有系列编号', () => {
  it('格式不对就复核不过，发布器不该被叫到', () => {
    const problems = validateDraft(draft({ existingCampaignId: 'not-an-id' }))
    expect(problems.some((p) => p.field === 'existingCampaignId')).toBe(true)
    expect(draftNotYetBuildable(draft({ existingCampaignId: '900001' }))).toBeNull()
  })

  it('确认卡写明是加到已有系列，换一个系列编号指纹就变', () => {
    const first = pausedDraftFacts(draft({ existingCampaignId: '900001' }), '账户', REVIEW)
    const second = pausedDraftFacts(draft({ existingCampaignId: '900002' }), '账户', REVIEW)
    expect(first.scope).toContain('已有系列')
    expect(first.scope).not.toBe(second.scope)
    expect(describeDraft(draft({ existingCampaignId: '900001' }))).toContain('已有系列')
  })

  it('已在投加上新组超过上限 → 红灯，刚好等于上限 → 通过', () => {
    const cap = {
      ...REVIEW,
      accounts: [{ ...REVIEW.accounts[0], daily_cap_cents: 15000 }],
      clientCapCents: 20000,
      liveDeliveringCents: 14500,
    }
    const blocked = pausedDraftFacts(draft({ dailyBudget: 30, existingCampaignId: '900001' }), '账户', cap)
    expect(blocked.hardChecks.find((check) => check.label === '日预算上限')).toMatchObject({ state: 'red' })
    const room = pausedDraftFacts(draft({ dailyBudget: 5, existingCampaignId: '900001' }), '账户', cap)
    expect(room.hardChecks.find((check) => check.label === '日预算上限')).toMatchObject({ state: 'green' })
  })

  it('已在投没读到就不能确认；系列预算或目标对不上就红灯', () => {
    const unread = pausedDraftFacts(
      draft({ existingCampaignId: '900001' }),
      '账户',
      { ...REVIEW, liveDeliveringCents: null },
    )
    expect(unread.hardChecks.find((check) => check.label === '日预算上限')?.state).toBe('unread')
    const cbo = pausedDraftFacts(draft({ existingCampaignId: '900001' }), '账户', {
      ...REVIEW,
      campaignShapes: [{ entityId: '900001', objective: 'OUTCOME_LEADS', budgetLevel: 'cbo' }],
    })
    expect(cbo.hardChecks.find((check) => check.label === '系列目标和预算')).toMatchObject({ state: 'red' })
    const other = pausedDraftFacts(draft({ existingCampaignId: '900001' }), '账户', {
      ...REVIEW,
      campaignShapes: [{ entityId: '900001', objective: 'OUTCOME_AWARENESS', budgetLevel: 'abo' }],
    })
    expect(other.hardChecks.find((check) => check.label === '系列目标和预算')?.reason).toContain('不一致')
  })
})
