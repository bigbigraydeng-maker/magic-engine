import { describe, it, expect } from 'vitest'
import { checkLaunch, type LaunchReadbackInput } from '@/lib/ads-strategy/launch-readback'
import { adaptMetaAdSet } from '@/lib/ads-strategy/meta-readback-adapter'
import { validateDraft, type AdDraft } from '@/lib/ads-strategy/ad-draft'
import { draftNotYetBuildable, readPromoPhaseAdSets } from '@/lib/ads-strategy/ad-draft-expansion'

const base = (over: Partial<LaunchReadbackInput> = {}): LaunchReadbackInput => ({
  adSet: {
    adSetId: 'AS1', adSetName: '组', optimizationGoal: 'LEAD_GENERATION',
    targeting: { publisherPlatforms: ['instagram'] },
    creatives: [{ adId: 'A1', adName: 'EN', buyerFacingText: ['Hello'] }],
  },
  ...over,
})

describe('回读按计划对版位', () => {
  it('计划只要 Instagram，回读也是：放行，不再要求 Facebook', () => {
    const r = checkLaunch(base({ expectedPublisherPlatforms: ['instagram'] }))
    expect(r.safeToActivate).toBe(true)
    expect(r.findings.map((f) => f.code)).not.toContain('playback_placement_not_locked')
  })

  it('计划只要 Instagram，回读多了 Facebook 或 Audience Network：拦住', () => {
    const extra = checkLaunch(base({
      adSet: { ...base().adSet, targeting: { publisherPlatforms: ['facebook', 'instagram'] } },
      expectedPublisherPlatforms: ['instagram'],
    }))
    const network = checkLaunch(base({
      adSet: { ...base().adSet, targeting: { publisherPlatforms: ['instagram', 'audience_network'] } },
      expectedPublisherPlatforms: ['instagram'],
    }))
    expect(extra.findings.map((f) => f.code)).toContain('placement_not_as_planned')
    expect(network.findings.map((f) => f.message).join('')).toContain('Audience Network')
    expect(extra.safeToActivate).toBe(false)
  })

  it('看完类视频没给计划版位：仍要求正好 Facebook 和 Instagram', () => {
    const open = checkLaunch(base({
      adSet: { ...base().adSet, optimizationGoal: 'THRUPLAY', targeting: { publisherPlatforms: ['instagram'] } },
      expectedOptimizationGoal: 'THRUPLAY',
    }))
    expect(open.findings.map((f) => f.code)).toContain('playback_placement_not_locked')
  })

  it('计划写了具体位置才对位置；只写平台不对位置', () => {
    const platformsOnly = checkLaunch(base({
      adSet: { ...base().adSet, targeting: { publisherPlatforms: ['instagram'] } },
      expectedPublisherPlatforms: ['instagram'],
    }))
    const missing = checkLaunch(base({
      adSet: { ...base().adSet, targeting: { publisherPlatforms: ['instagram'], instagramPositions: ['stream'] } },
      expectedPublisherPlatforms: ['instagram'],
      expectedInstagramPositions: ['reels'],
    }))
    expect(platformsOnly.safeToActivate).toBe(true)
    expect(missing.findings.map((f) => f.code)).toContain('placement_not_as_planned')
  })

  it('适配器把位置数组交给闸门', () => {
    const input = adaptMetaAdSet(
      {
        id: '1', name: '组', optimization_goal: 'LEAD_GENERATION',
        targeting: { publisher_platforms: ['instagram'], instagram_positions: ['reels'] },
      },
      [{ adId: 'a', adName: 'EN', texts: ['Hello'] }],
    )
    expect(input.adSet.targeting.instagramPositions).toEqual(['reels'])
    const r = checkLaunch({
      ...input,
      expectedPublisherPlatforms: ['instagram'],
      expectedInstagramPositions: ['reels'],
    })
    expect(r.safeToActivate).toBe(true)
  })
})

const DRAFT: AdDraft = {
  kind: 'lead_form', clientId: 'c1', campaignName: '留资', adSetName: '买家',
  dailyBudget: 30, durationDays: 7, geoCountries: ['NZ'], pageId: 'p1', leadFormId: 'f1',
  linkUrl: 'https://example.co.nz',
  creatives: [{ name: 'EN', primaryText: 'Brand new home', headline: 'Book', imageHash: 'h1' }],
}

describe('草稿接受计划里的版位', () => {
  it('认识的词不挡住单组草稿；不认识的词拦住', () => {
    expect(validateDraft({ ...DRAFT, placements: ['instagram'] })).toEqual([])
    expect(draftNotYetBuildable({ ...DRAFT, placements: ['instagram'] })).toBeNull()
    const bad = validateDraft({ ...DRAFT, placements: ['reels'] })
    expect(bad.some((p) => p.field === 'placements')).toBe(true)
  })

  it('计划步骤上的版位抄到广告组；坏词则不返回广告组', () => {
    const ok = readPromoPhaseAdSets(promo(['instagram_reels']), 'p1')
    expect(ok.problems).toEqual([])
    expect(ok.adSets?.[0].placements).toEqual(['instagram_reels'])
    expect(ok.adSets?.[1].placements).toBeUndefined()
    const bad = readPromoPhaseAdSets(promo(['stories']), 'p1')
    expect(bad.adSets).toBeUndefined()
    expect(bad.problems.map((p) => p.message).join('')).toContain('没写清')
  })
})

function promo(placements: string[]) {
  const step = (id: string, country: string, where: string[]) => ({
    id,
    kind: 'ads_campaign' as const,
    settings: {
      ad_account_id: 'act_1',
      daily_budget_cents: 1500,
      audience_ref: '',
      creative_refs: [],
      placements: where,
      paused_ranges: [],
      targeting: { countries: [country], city_keys: [], excluded_audience_refs: [] },
    },
  })
  return {
    schema: 'promo_v1',
    goal_id: 'g1',
    phases: [{
      id: 'p1',
      name: 'phase',
      start_date: '2026-11-01',
      end_date: '2026-11-14',
      steps: [step('step-a', 'NZ', placements), step('step-b', 'AU', [])],
    }],
  }
}
