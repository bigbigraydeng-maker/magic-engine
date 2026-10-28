import { describe, expect, it } from 'vitest'
import { describeDraft, validateDraft, type AdDraft, type AdDraftAdSet } from '../ad-draft'
import {
  draftNotYetBuildable,
  readPromoPhaseAdSets,
  reviewDraftAgainstCaps,
  reviewDraftForBuild,
} from '../ad-draft-expansion'
import type { AudienceFact } from '../draft-audiences'

const OFF = {
  advantageAudience: false,
  customAudienceRelaxed: false,
  lookalikeRelaxed: false,
}

function creative() {
  return { name: 'A', primaryText: 'Hello there', headline: 'Read more', imageHash: 'h1' }
}

function adSet(over: Partial<AdDraftAdSet> = {}): AdDraftAdSet {
  return {
    name: 'group-a',
    dailyBudget: 15,
    geoCountries: ['NZ'],
    creatives: [creative()],
    ...over,
  }
}

function multi(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'lead_form',
    clientId: 'c1',
    campaignName: 'lead campaign',
    adSetName: '',
    dailyBudget: 30,
    durationDays: 7,
    geoCountries: [],
    pageId: 'p1',
    leadFormId: 'f1',
    creatives: [],
    budgetMode: 'ad_set',
    adSets: [
      adSet({ audienceIds: ['1111111'], excludedAudienceIds: ['2222222'], expansion: OFF }),
      adSet({ name: 'group-b' }),
    ],
    ...over,
  }
}

const fields = (d: AdDraft) => validateDraft(d).map((x) => x.field)

describe('扩展后的广告草稿', () => {
  it('两个广告组、组预算、受众和排除都写了、扩量全关 → 校验通过', () => {
    expect(validateDraft(multi())).toEqual([])
    expect(describeDraft(multi())).toContain('2 个广告组')
  })

  it('旧的单组草稿一个新字段都没有 → 还是通过，摘要不提广告组个数', () => {
    const legacy: AdDraft = {
      kind: 'lead_form', clientId: 'c1', campaignName: 'n', adSetName: 'a',
      dailyBudget: 30, durationDays: 7, geoCountries: ['NZ'], pageId: 'p1', leadFormId: 'f1',
      creatives: [creative()],
    }
    expect(validateDraft(legacy)).toEqual([])
    expect(describeDraft(legacy)).not.toContain('广告组')
    expect(draftNotYetBuildable(legacy)).toBeNull()
  })

  it('各组日预算加起来和每天预算对不上 → 拦', () => {
    expect(fields(multi({ dailyBudget: 20 }))).toContain('dailyBudget')
  })

  it('没写预算放在哪 → 拦，不猜成系列预算或组预算', () => {
    const d = multi()
    delete d.budgetMode
    expect(fields(d)).toContain('budgetMode')
  })

  it('系列预算：各组不写日预算，合计写在系列上 → 通过', () => {
    const d = multi({
      budgetMode: 'campaign',
      campaignDailyBudget: 30,
      adSets: [
        adSet({ dailyBudget: undefined, minDailyBudget: 5, maxDailyBudget: 20, audienceIds: ['1111111'], expansion: OFF }),
        adSet({ name: 'group-b', dailyBudget: undefined }),
      ],
    })
    expect(validateDraft(d)).toEqual([])
    expect(describeDraft(d)).toContain('系列预算')
    expect(draftNotYetBuildable(d)).toContain('系列预算')
  })

  it('系列预算时又给组写日预算 → 拦', () => {
    const d = multi({
      budgetMode: 'campaign',
      campaignDailyBudget: 30,
      adSets: [adSet({ minDailyBudget: 40 })],
    })
    expect(fields(d)).toContain('adSets[0].dailyBudget')
  })

  it('各组下限加起来超过系列预算 → 拦', () => {
    const d = multi({
      budgetMode: 'campaign',
      campaignDailyBudget: 30,
      adSets: [
        adSet({ dailyBudget: undefined, minDailyBudget: 20, audienceIds: ['1111111'], expansion: OFF }),
        adSet({ name: 'group-b', dailyBudget: undefined, minDailyBudget: 20 }),
      ],
    })
    expect(fields(d).filter((f) => f === 'campaignDailyBudget').length).toBeGreaterThan(0)
  })

  it('挂了受众却没写扩量开关 → 建前复核过不了', () => {
    const d = multi({
      adSets: [adSet({ audienceIds: ['1111111'] }), adSet({ name: 'group-b' })],
    })
    expect(fields(d)).toContain('adSets[0].expansion')
  })

  it('挂了受众但优势受众开着 → 拦', () => {
    const d = multi({
      adSets: [
        adSet({
          audienceIds: ['1111111'],
          expansion: { ...OFF, advantageAudience: true, source: 'step-1' },
        }),
        adSet({ name: 'group-b' }),
      ],
    })
    expect(fields(d)).toContain('adSets[0].expansion')
  })

  it('只排除、不包含，相似人群开着 → 拦', () => {
    const d = multi({
      adSets: [
        adSet({
          excludedAudienceIds: ['2222222'],
          expansion: { ...OFF, lookalikeRelaxed: true, source: 'step-1' },
        }),
      ],
      dailyBudget: 15,
    })
    expect(fields(d)).toContain('adSets[0].expansion')
  })

  it('没有受众时打开扩量，必须写出处；写了出处校验通过，但现在还不能拿去建', () => {
    const opened = { advantageAudience: true, customAudienceRelaxed: false, lookalikeRelaxed: false }
    const missing = multi({
      adSets: [adSet({ expansion: opened })],
      dailyBudget: 15,
    })
    expect(fields(missing)).toContain('adSets[0].expansion.source')
    const sourced = multi({
      adSets: [adSet({ expansion: { ...opened, source: 'step-1' } })],
      dailyBudget: 15,
    })
    expect(validateDraft(sourced)).toEqual([])
    expect(draftNotYetBuildable(sourced)).toContain('多个广告组')
  })

  it('国家和城市同时填 → 拦', () => {
    const d = multi({
      adSets: [adSet({ geoCityKeys: ['city-1'] })],
      dailyBudget: 15,
    })
    expect(fields(d)).toContain('adSets[0].geoCityKeys')
  })

  it('按钮写错 → 拦；网址参数带问号 → 拦；空首评 → 拦', () => {
    expect(fields(multi({ adSets: [adSet({ ctaType: 'BUY_NOW' })], dailyBudget: 15 }))).toContain('adSets[0].ctaType')
    expect(fields(multi({ adSets: [adSet({ urlTags: '?utm_medium=paid' })], dailyBudget: 15 }))).toContain('adSets[0].urlTags')
    expect(fields(multi({ adSets: [adSet({ firstComment: '   ' })], dailyBudget: 15 }))).toContain('adSets[0].firstComment')
  })

  it('单个旧草稿挂了受众但没写开关：validateDraft 仍通过，建前复核拦住', () => {
    const d: AdDraft = {
      kind: 'lead_form', clientId: 'c1', campaignName: 'n', adSetName: 'a',
      dailyBudget: 30, durationDays: 7, geoCountries: ['NZ'], pageId: 'p1', leadFormId: 'f1',
      creatives: [creative()],
      audienceIds: ['1111111'],
    }
    expect(validateDraft(d)).toEqual([])
    expect(reviewDraftForBuild(d).map((x) => x.field)).toContain('expansion')
    const reviewed = reviewDraftForBuild({ ...d, expansion: OFF })
    expect(reviewed).toEqual([])
    expect(draftNotYetBuildable({ ...d, expansion: OFF })).toBeNull()
  })

  it('单个草稿写明打开优势受众、没有名单外扩量 → 能按草稿建', () => {
    const d: AdDraft = {
      kind: 'lead_form', clientId: 'c1', campaignName: 'n', adSetName: 'a',
      dailyBudget: 30, durationDays: 7, geoCountries: ['NZ'], pageId: 'p1', leadFormId: 'f1',
      creatives: [creative()],
      expansion: {
        advantageAudience: true,
        customAudienceRelaxed: false,
        lookalikeRelaxed: false,
        source: 'ad-agent:default-advantage-plus',
      },
    }
    expect(reviewDraftForBuild(d)).toEqual([])
    expect(draftNotYetBuildable(d)).toBeNull()
  })
})

describe('建前复核用已经读到的数，自己不读 Meta', () => {
  it('最低日预算没读到 → 不能当成通过；读到了而且组预算更低 → 拦', () => {
    const unread = reviewDraftForBuild(multi(), { minDailyBudget: null })
    expect(unread.map((x) => x.field)).toContain('minDailyBudget')
    const low = reviewDraftForBuild(multi(), { minDailyBudget: { minor: 2000, currency: 'NZD' } })
    expect(low.some((x) => x.field.startsWith('adSets['))).toBe(true)
  })

  it('受众事实没给 → 不能当成通过；编号不在账户里 → 拦', () => {
    const unread = reviewDraftForBuild(multi(), { audienceFacts: null })
    expect(unread.map((x) => x.message).join('')).toContain('没读到')
    const facts = new Map<string, AudienceFact>([
      ['2222222', fact('2222222', 1000)],
    ])
    const missing = reviewDraftForBuild(multi(), { audienceFacts: facts })
    expect(missing.map((x) => x.message).join('')).toContain('不属于这个广告账户')
  })

  it('包含受众太小 → 拦；都够大 → 这一项通过', () => {
    const small = new Map<string, AudienceFact>([
      ['1111111', fact('1111111', 10)],
      ['2222222', fact('2222222', 1000)],
    ])
    expect(reviewDraftForBuild(multi(), { audienceFacts: small }).map((x) => x.message).join('')).toContain('太小')
    const ready = new Map<string, AudienceFact>([
      ['1111111', fact('1111111', 1000)],
      ['2222222', fact('2222222', 1000)],
    ])
    expect(reviewDraftForBuild(multi(), { audienceFacts: ready })).toEqual([])
  })

  it('预算上限沿用计划那道检查：两组加起来超了账户上限 → 超', () => {
    const r = reviewDraftAgainstCaps(
      multi(),
      'act_1',
      [{ ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 1000, owned_by_client: true }],
      5000,
    )
    expect(r.verdict).toBe('over')
    expect(r.per_account_cents.act_1).toBe(3000)
  })

  it('没给广告账户 → 核不成，不编一个账户', () => {
    expect(reviewDraftAgainstCaps(multi(), '  ', [], null).verdict).toBe('unknown')
  })
})

describe('从计划步骤投影广告组', () => {
  it('一个阶段两个步骤、受众是编号 → 两个组、组预算，文案留空', () => {
    const r = readPromoPhaseAdSets(promo('1111111'), 'p1')
    expect(r.problems).toEqual([])
    expect(r.budgetMode).toBe('ad_set')
    expect(r.dailyBudget).toBe(30)
    expect(r.adSets).toHaveLength(2)
    expect(r.adSets?.[0].audienceIds).toEqual(['1111111'])
    expect(r.adSets?.[0].excludedAudienceIds).toEqual(['3333333'])
    expect(r.adSets?.[0].creatives).toEqual([])
  })

  it('受众引用不是编号 → 不返回广告组，也不猜', () => {
    const r = readPromoPhaseAdSets(promo('pool-a'), 'p1')
    expect(r.adSets).toBeUndefined()
    expect(r.problems.map((x) => x.message).join('')).toContain('不是受众编号')
  })

  it('没有投放地区 → 不猜国家', () => {
    const raw = promo('1111111')
    const step = (raw as { phases: { steps: { settings: { targeting?: unknown } }[] }[] }).phases[0].steps[0]
    delete step.settings.targeting
    const r = readPromoPhaseAdSets(raw, 'p1')
    expect(r.adSets).toBeUndefined()
    expect(r.problems.map((x) => x.message).join('')).toContain('不猜国家')
  })

  it('计划本身读不懂 → 用同一套解析的报错', () => {
    const r = readPromoPhaseAdSets({ schema: 'nope' }, 'p1')
    expect(r.problems.length).toBeGreaterThan(0)
    expect(r.adSets).toBeUndefined()
  })
})

function fact(id: string, count: number): AudienceFact {
  return {
    id,
    name: null,
    operationStatusCode: 200,
    deliveryStatusCode: 200,
    countLowerBound: count,
  }
}

function promo(audienceRef: string) {
  const step = (id: string, ref: string, country: string, excluded: string[]) => ({
    id,
    kind: 'ads_campaign' as const,
    settings: {
      ad_account_id: 'act_1',
      daily_budget_cents: 1500,
      audience_ref: ref,
      creative_refs: [],
      placements: [],
      paused_ranges: [],
      targeting: { countries: [country], city_keys: [], excluded_audience_refs: excluded },
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
      steps: [step('step-a', audienceRef, 'NZ', ['3333333']), step('step-b', '4444444', 'AU', [])],
    }],
  }
}
